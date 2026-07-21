// Extension layer: lifecycle + routing only. No AI logic lives here — the
// pipeline runs in the offscreen document; this file moves messages between
// contexts and owns the dictation state machine.

import { getSettings } from "../src/shared/settings";
import type {
  BackgroundMessage,
  ContentMessage,
  OffscreenMessage,
} from "../src/shared/types";

type State = "idle" | "listening" | "processing";

export default defineBackground(() => {
  let state: State = "idle";
  let targetTabId: number | null = null;
  let tabReachable = false;
  // Clipboard mode: dictation started from ANOTHER app via the global
  // shortcut. No tab, no overlay — the result goes to the clipboard and the
  // offscreen document beeps so the user gets feedback without seeing Chrome.
  let clipboardMode = false;

  async function setState(next: State) {
    state = next;
    const badge =
      next === "listening" ? "REC" : next === "processing" ? "…" : "";
    try {
      await chrome.action.setBadgeText({ text: badge });
      if (next === "listening") {
        await chrome.action.setBadgeBackgroundColor({ color: "#E8620A" });
        await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
      }
    } catch {
      /* badge races during startup are harmless */
    }
    chrome.runtime
      .sendMessage({ target: "popup", type: "state-changed", state: next })
      .catch(() => {});
  }

  async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: "/offscreen.html",
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification:
        "Captures microphone audio and runs the dictation pipeline.",
    });
  }

  function sendToTab(msg: ContentMessage) {
    if (targetTabId == null) return;
    chrome.tabs.sendMessage(targetTabId, msg).catch(() => {});
  }

  function sendToOffscreen(msg: OffscreenMessage) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  async function pingTab(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ping" });
      return true;
    } catch {
      return false;
    }
  }

  // Content scripts only auto-load into pages opened after install; inject on
  // demand for older tabs so the shortcut never silently does nothing.
  async function ensureContentScript(tabId: number | null): Promise<boolean> {
    if (tabId == null) return false;
    if (await pingTab(tabId)) return true;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"],
      });
    } catch {
      return false; // chrome:// page, Web Store, PDF viewer
    }
    return pingTab(tabId);
  }

  function flashBadge(text: string, ms: number) {
    chrome.action.setBadgeText({ text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: "#0E7568" }).catch(() => {});
    setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), ms);
  }

  async function startDictation(clipboard = false) {
    if (state !== "idle") return;
    clipboardMode = clipboard;
    if (clipboard) {
      targetTabId = null;
      tabReachable = false;
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTabId = tab?.id ?? null;
      tabReachable = await ensureContentScript(targetTabId);
    }
    const settings = await getSettings();
    await ensureOffscreen();
    await setState("listening");
    if (!clipboard) sendToTab({ type: "overlay-show" });
    sendToOffscreen({
      target: "offscreen",
      type: "start",
      settings,
      feedback: clipboard,
    });
  }

  async function stopDictation() {
    if (state !== "listening") return;
    await setState("processing");
    if (!clipboardMode) sendToTab({ type: "overlay-processing" });
    sendToOffscreen({ target: "offscreen", type: "stop" });
  }

  async function toggleDictation(clipboard = false) {
    if (state === "listening") await stopDictation();
    else if (state === "idle") await startDictation(clipboard);
  }

  async function finishWithTranscript(transcript: string) {
    const settings = await getSettings();
    const text = transcript.trim();
    if (text) {
      if (tabReachable) {
        sendToTab({ type: "insert-text", text });
      } else {
        sendToOffscreen({ target: "offscreen", type: "copy", text });
        flashBadge("COPY", 4000);
      }
      // History limit 0 is a real off switch: keep nothing, not even the
      // popup's "last transcription". Zero means zero.
      if (settings.historyLimit > 0) {
        const { history = [] } = await chrome.storage.local.get("history");
        history.unshift({ text, ts: Date.now() });
        await chrome.storage.local.set({
          history: history.slice(0, settings.historyLimit),
          lastTranscript: text,
        });
      }
      // If the pop-out is open, show the result there too — it is the natural
      // place to look when the page couldn't take the insertion.
      chrome.runtime
        .sendMessage({ target: "popout", type: "transcript", text })
        .catch(() => {});
    }
    sendToTab({ type: "overlay-hide" });
    await setState("idle");
  }

  let popoutWindowId: number | null = null;
  let popoutListening = false;

  // MV3 service workers shut down after ~30s idle and restart cold, wiping
  // in-memory state. Without this, the shortcut stops recognizing an open
  // pop-out (and routes dictation to the offscreen document instead, so the
  // pop-out never shows its listening state). storage.session survives worker
  // restarts and clears with the browser — the same lifetime as the window.
  const popoutStateReady = chrome.storage.session
    .get(["popoutWindowId", "popoutListening"])
    .then((s) => {
      if (typeof s.popoutWindowId === "number") popoutWindowId = s.popoutWindowId;
      if (typeof s.popoutListening === "boolean") popoutListening = s.popoutListening;
    })
    .catch(() => {});

  function persistPopoutState() {
    chrome.storage.session
      .set({ popoutWindowId, popoutListening })
      .catch(() => {});
  }

  // Belt and braces: even with no remembered id (fresh worker, pop-out opened
  // in an earlier life), the pop-out is recognizable by what it shows.
  async function isPopoutWindow(win: chrome.windows.Window): Promise<boolean> {
    if (win.id != null && win.id === popoutWindowId) return true;
    if (win.type !== "popup" || win.id == null) return false;
    try {
      const tabs = await chrome.tabs.query({ windowId: win.id });
      return !!tabs[0]?.url?.startsWith(chrome.runtime.getURL("/popout.html"));
    } catch {
      return false;
    }
  }

  async function openPopout() {
    if (popoutWindowId != null) {
      try {
        await chrome.windows.update(popoutWindowId, { focused: true });
        return;
      } catch {
        popoutWindowId = null; // window was closed
      }
    }
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("/popout.html"),
      type: "popup",
      width: 420,
      height: 560,
      focused: true,
    });
    popoutWindowId = win.id ?? null;
    persistPopoutState();
  }

  chrome.windows.onRemoved.addListener((id) => {
    if (id === popoutWindowId) {
      popoutWindowId = null;
      popoutListening = false; // a closed pop-out can't be listening
      persistPopoutState();
    }
  });

  function togglePopout() {
    chrome.runtime.sendMessage({ target: "popout", type: "toggle" }).catch(() => {});
  }

  // ONE shortcut, context-smart:
  //   a session is running somewhere        -> stop it (wherever it is)
  //   pop-out window focused                -> its session (live transcript)
  //   a Chrome window focused               -> page flow (overlay + insert)
  //   any other app focused                 -> clipboard mode (beeps + paste)
  async function smartToggle() {
    // The worker may have just woken up cold: recover the pop-out routing
    // state before deciding where this press should go.
    await popoutStateReady;
    if (popoutListening) {
      togglePopout();
      return;
    }
    if (state === "listening") {
      void stopDictation();
      return;
    }
    if (state !== "idle") return;

    let focusedWindow: chrome.windows.Window | null = null;
    try {
      focusedWindow = await chrome.windows.getLastFocused();
    } catch {
      /* no window info — treat as another app */
    }
    if (focusedWindow?.focused) {
      if (await isPopoutWindow(focusedWindow)) {
        // Re-adopt the window if the id was lost to a worker restart.
        popoutWindowId = focusedWindow.id ?? popoutWindowId;
        persistPopoutState();
        togglePopout();
        return;
      }
      void startDictation(false);
      return;
    }
    void startDictation(true);
  }

  chrome.commands.onCommand.addListener((command) => {
    if (command === "dictate-from-anywhere") void smartToggle();
  });

  // First install: open onboarding so the mic grant, shortcut check, and a
  // first dictation all happen up front — after this page, it just works.
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      void chrome.tabs.create({ url: chrome.runtime.getURL("/onboarding.html") });
    }
  });

  chrome.runtime.onMessage.addListener(
    (msg: BackgroundMessage, _sender, sendResponse) => {
      if (!msg || msg.target !== "background") return;
      switch (msg.type) {
        case "toggle":
          void toggleDictation();
          break;
        case "open-popout":
          void openPopout();
          break;
        case "popout-state":
          popoutListening = msg.listening;
          persistPopoutState();
          break;
        case "copy-request":
          // Pop-out asking for an unfocused-safe clipboard write: the
          // offscreen document's execCommand copy works without focus.
          void (async () => {
            await ensureOffscreen();
            sendToOffscreen({ target: "offscreen", type: "copy", text: msg.text });
          })();
          break;
        case "get-state":
          sendResponse({ state });
          return;
        case "level":
          sendToTab({ type: "overlay-level", levels: msg.levels });
          break;
        case "text":
          // The offscreen pipeline pre-splits committed/tentative for us.
          break;
        case "done":
          void finishWithTranscript(msg.transcript);
          break;
        case "mic-denied":
          sendToTab({ type: "overlay-hide" });
          void setState("idle");
          void chrome.tabs.create({
            url: chrome.runtime.getURL("/onboarding.html"),
          });
          break;
        case "engine-error":
          sendToTab({ type: "overlay-error", message: msg.message });
          void setState("idle");
          setTimeout(() => sendToTab({ type: "overlay-hide" }), 2400);
          break;
      }
    },
  );

  // Overlay text updates flow directly offscreen → background → tab with the
  // committed/tentative split; wire it as its own listener to keep types tidy.
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.target === "background" && msg.type === "overlay-text") {
      sendToTab({
        type: "overlay-text",
        committed: msg.committed,
        tentative: msg.tentative,
      });
    }
  });
});
