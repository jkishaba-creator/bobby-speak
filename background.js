// Bobby Speak — service worker.
// Owns the dictation state machine and routes messages between the
// offscreen document (mic + speech engine), the content script (overlay +
// insertion), and the popup. Mirrors Handy's coordinator, toggle-mode only.

importScripts("lib/textCleanup.js", "lib/grammarPolish.js");

const STATE = { IDLE: "idle", LISTENING: "listening", PROCESSING: "processing" };

const DEFAULT_SETTINGS = {
  engine: "chrome",
  language: "en-US",
  cfAccountId: "",
  cfApiToken: "",
  cfGateway: "",
  removeFillers: true,
  spokenPunctuation: true,
  aiPolish: true,
  customWords: [],
  historyLimit: 25,
};

let state = STATE.IDLE;
let targetTabId = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}

async function setState(next) {
  state = next;
  const badge =
    next === STATE.LISTENING ? "REC" : next === STATE.PROCESSING ? "…" : "";
  try {
    await chrome.action.setBadgeText({ text: badge });
    if (next === STATE.LISTENING) {
      await chrome.action.setBadgeBackgroundColor({ color: "#E8620A" });
      await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    }
  } catch (_) {
    // badge APIs can throw during startup races; state itself is what matters
  }
  chrome.runtime
    .sendMessage({ target: "popup", type: "state-changed", state: next })
    .catch(() => {});
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification:
      "Captures microphone audio and runs speech recognition for dictation.",
  });
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function sendToTab(msg) {
  if (targetTabId == null) return;
  chrome.tabs.sendMessage(targetTabId, msg).catch(() => {
    // tab may be a chrome:// page or have navigated; overlay is best-effort
  });
}

async function startDictation() {
  if (state !== STATE.IDLE) return;
  targetTabId = await getActiveTabId();
  const settings = await getSettings();
  await ensureOffscreen();
  await setState(STATE.LISTENING);
  sendToTab({ type: "overlay-show" });
  chrome.runtime
    .sendMessage({
      target: "offscreen",
      type: "start",
      settings: {
        engine: settings.engine,
        language: settings.language,
        cfAccountId: settings.cfAccountId,
        cfApiToken: settings.cfApiToken,
        cfGateway: settings.cfGateway,
      },
    })
    .catch(() => {});
}

async function stopDictation() {
  if (state !== STATE.LISTENING) return;
  await setState(STATE.PROCESSING);
  sendToTab({ type: "overlay-processing" });
  chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
}

async function toggleDictation() {
  if (state === STATE.LISTENING) await stopDictation();
  else if (state === STATE.IDLE) await startDictation();
}

async function finishWithTranscript(raw) {
  const settings = await getSettings();
  let text = TextCleanup.clean(raw, settings);
  if (text && settings.aiPolish !== false) {
    const polished = await GrammarPolish.polish(text);
    if (polished) text = polished;
  }
  if (text) {
    sendToTab({ type: "insert-text", text });
    const { history = [] } = await chrome.storage.local.get("history");
    history.unshift({ text, ts: Date.now() });
    await chrome.storage.local.set({
      history: history.slice(0, settings.historyLimit),
      lastTranscript: text,
    });
  }
  sendToTab({ type: "overlay-hide" });
  await setState(STATE.IDLE);
}

async function handleMicDenied() {
  sendToTab({ type: "overlay-hide" });
  await setState(STATE.IDLE);
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
}

async function handleEngineError(message) {
  sendToTab({ type: "overlay-error", message: message || "Speech engine error" });
  await setState(STATE.IDLE);
  setTimeout(() => sendToTab({ type: "overlay-hide" }), 2400);
}

let popoutWindowId = null;

async function openPopout() {
  if (popoutWindowId != null) {
    try {
      await chrome.windows.update(popoutWindowId, { focused: true });
      return;
    } catch (_) {
      popoutWindowId = null; // window was closed
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popout.html"),
    type: "popup",
    width: 420,
    height: 560,
    focused: true,
  });
  popoutWindowId = win.id;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === popoutWindowId) popoutWindowId = null;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-dictation") toggleDictation();
  if (command === "open-popout") openPopout();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "background") return;

  switch (msg.type) {
    case "toggle":
      toggleDictation();
      break;
    case "open-popout":
      openPopout();
      break;
    case "get-state":
      sendResponse({ state });
      return; // synchronous response
    case "level":
      sendToTab({ type: "overlay-level", levels: msg.levels });
      break;
    case "interim":
      sendToTab({
        type: "overlay-text",
        committed: msg.committed,
        tentative: msg.tentative,
      });
      break;
    case "final":
      finishWithTranscript(msg.transcript);
      break;
    case "mic-denied":
      handleMicDenied();
      break;
    case "engine-error":
      handleEngineError(msg.message);
      break;
  }
});
