<script lang="ts">
  // The pop-out: dictation for OTHER apps and sites. Runs the full pipeline
  // directly in this visible window (mic access is granted to the extension
  // origin) and keeps the system clipboard preloaded with the cleaned
  // transcript as you speak — talk here, ⌘V into anything, including native
  // apps. Ported from v1; same Air OS look, v2 wiring underneath.

  import { startDictation, type DictationSession } from "../../src/pipeline";
  import { getSettings, saveSettings } from "../../src/shared/settings";
  import {
    DEFAULT_SETTINGS,
    type SavedPrompt,
    type Settings,
    type ToneId,
  } from "../../src/shared/types";
  import { sanitizeSavedPrompt, suggestPromptName } from "../../src/shared/prompts";
  import {
    TEXT_ACTIONS,
    TONES,
    chipsUsable,
    resolveActions,
    runTextAction,
    type TextAction,
  } from "../../src/ai/textActions";

  const hasChrome =
    typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const pasteKey = isMac ? "⌘V" : "Ctrl+V";

  let listening = $state(false);
  let transcriptText = $state("");
  let tentative = $state("");
  let clipMessage = $state("Clipboard idle");
  let clipTone: "idle" | "ok" | "err" = $state("idle");
  let statusTitle = $state("Click the orb, then talk");
  let statusSub = $state("Your words are kept on the clipboard as you go");
  let levels: number[] = $state([0, 0, 0, 0, 0, 0, 0, 0, 0]);

  let session: DictationSession | null = null;
  let settings: Settings = $state({ ...DEFAULT_SETTINGS });
  let pendingCopy: string | null = null;
  let unsubscribe: (() => void) | null = null;

  // Load settings up front so the AI action chips can tell, before the first
  // dictation, whether Cloudflare credentials are present.
  (async () => {
    if (hasChrome) settings = await getSettings();
  })();

  // Keep the chip row and tone in sync when the options page (or another
  // window) edits the customized action set while this pop-out is open.
  $effect(() => {
    if (!hasChrome || !chrome.storage?.onChanged) return;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes.settings) void reloadSettings();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  });

  async function reloadSettings() {
    if (hasChrome) settings = await getSettings();
  }

  async function copyToClipboard(text: string, quiet = true) {
    if (!text) {
      if (!quiet) setClip("Nothing to copy", "err");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pendingCopy = null;
      setClip("On clipboard — " + pasteKey + " anywhere", "ok");
    } catch {
      // Direct writes need window focus. Route through the offscreen
      // document instead — its clipboard write works unfocused — so the
      // clipboard stays loaded while the user works in another app.
      if (hasChrome) {
        chrome.runtime
          .sendMessage({ target: "background", type: "copy-request", text })
          .then(() => setClip("On clipboard — " + pasteKey + " anywhere", "ok"))
          .catch(() => {
            pendingCopy = text;
            setClip("Refocus this window to copy", "err");
          });
      } else {
        pendingCopy = text;
        setClip("Refocus this window to copy", "err");
      }
    }
  }

  $effect(() => {
    const onFocus = () => {
      if (pendingCopy) void copyToClipboard(pendingCopy);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  // The background routes the global shortcut here while this window is
  // focused, and mirrors page-flow transcripts here for display.
  $effect(() => {
    if (!hasChrome) return;
    const onMessage = (msg: { target?: string; type?: string; text?: string }) => {
      if (msg?.target !== "popout") return;
      if (msg.type === "toggle") toggle();
      if (msg.type === "transcript" && msg.text && !listening) {
        transcriptText = msg.text;
        setClip("On clipboard — " + pasteKey + " anywhere", "ok");
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  });

  function setClip(message: string, tone: "idle" | "ok" | "err") {
    clipMessage = message;
    clipTone = tone;
  }

  async function start() {
    if (listening) return;
    settings = hasChrome ? await getSettings() : { ...DEFAULT_SETTINGS };
    session = startDictation($state.snapshot(settings));
    listening = true;
    reportState(true);
    statusTitle = "Listening…";
    statusSub =
      settings.engine === "cf-whisper"
        ? "Whisper transcribes when you stop (no live text)"
        : "Pause any time — the session survives silences";

    unsubscribe = session.events.subscribe((event) => {
      switch (event.type) {
        case "level":
          levels = event.levels;
          break;
        case "text":
          transcriptText = event.committed;
          tentative = event.tentative;
          if (event.committed) void copyToClipboard(event.committed);
          break;
        case "done": {
          finishUi();
          if (event.transcript) {
            transcriptText = event.transcript;
            void copyToClipboard(event.transcript);
          } else if (!transcriptText) {
            setClip("Clipboard idle", "idle");
          }
          // A chip tapped mid-recording waits here: the recording is finished
          // now, so run the action against the final transcript.
          const next = pendingAction;
          pendingAction = null;
          if (next) void applyAction(next);
          break;
        }
        case "mic-denied":
          pendingAction = null;
          finishUi();
          statusTitle = "Microphone blocked";
          statusSub =
            "Allow the mic for this window (icon in the address bar), then try again.";
          break;
        case "error":
          pendingAction = null;
          finishUi();
          statusTitle = "Engine error";
          statusSub = event.message;
          break;
      }
    });
  }

  async function stop() {
    if (!listening || !session) return;
    if (settings.engine === "cf-whisper") {
      statusTitle = "Transcribing…";
      statusSub = "Sending audio to Whisper on your Cloudflare account";
      setClip("Transcribing…", "idle");
    }
    await session.stop();
  }

  function reportState(on: boolean) {
    if (hasChrome) {
      chrome.runtime
        .sendMessage({ target: "background", type: "popout-state", listening: on })
        .catch(() => {});
    }
  }

  function finishUi() {
    listening = false;
    reportState(false);
    tentative = "";
    levels = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    statusTitle = "Click the orb, then talk";
    statusSub = "Your words are kept on the clipboard as you go";
    unsubscribe?.();
    unsubscribe = null;
    session = null;
  }

  function toggle() {
    if (listening) void stop();
    else void start();
  }

  function clearAll() {
    transcriptText = "";
    tentative = "";
    setClip("Clipboard idle", "idle");
    previous = null;
    askOpen = false;
    question = "";
    saveOpen = false;
    saveName = "";
    pendingAction = null;
  }

  // ---- AI text actions (clean / summarize / sharpen / ask) ----
  // Same shared actions the mobile app uses. Every action replaces the
  // transcript and stashes what it replaced, so a single Undo always gets you
  // back, and the result is auto-copied like everything else in the pop-out.
  const askAction = TEXT_ACTIONS.find((a) => a.needsQuestion)!;
  let running: string | null = $state(null);
  let previous: string | null = $state(null);
  let askOpen = $state(false);
  let question = $state("");
  // A chip tapped while recording: finish the take first, apply after "done".
  let pendingAction: TextAction | null = null;

  // The row the user actually sees: built-ins plus their custom chips, in the
  // user's saved order, minus anything hidden. Custom chips are one-tap like
  // the built-ins; only "ask" keeps its inline question input.
  const actions = $derived(resolveActions(settings));

  const actionsReady = $derived(
    !!transcriptText.trim() && !!settings.cfAccountId && !!settings.cfApiToken,
  );

  // The shared gate (src/ai/textActions.ts): keys-only while recording, keys
  // plus text otherwise — one rule for the pop-out and the web app alike.
  const chipUsable = $derived(chipsUsable(listening, transcriptText, settings));

  // Tone updates persist immediately so the choice carries into every window
  // and the next dictation, matching the built-in Settings surface.
  async function setTone(tone: ToneId) {
    settings = { ...settings, tone };
    if (hasChrome) await saveSettings($state.snapshot(settings));
  }

  function openOptions() {
    if (hasChrome) chrome.runtime.openOptionsPage();
  }

  async function applyAction(action: TextAction) {
    if (running) return;
    if (listening) {
      // Speak, then tap a chip: the tap finishes the recording, and the
      // action runs on the final transcript once the engine flushes it.
      pendingAction = action;
      setClip("Finishing the recording…", "idle");
      void stop();
      return;
    }
    if (action.needsQuestion && !askOpen) {
      askOpen = true;
      return;
    }
    if (!actionsReady) {
      setClip(
        !transcriptText.trim()
          ? "Dictate something first"
          : "Add your Cloudflare keys in Settings to use AI actions",
        "err",
      );
      return;
    }

    running = action.id;
    setClip("Working…", "idle");
    const before = transcriptText;
    const result = await runTextAction(
      action,
      transcriptText,
      $state.snapshot(settings),
      question,
    );
    running = null;

    // A new recording started while the model was working; its transcript
    // owns the pop-out now — don't clobber it with a stale result.
    if (listening) return;

    if (!result.ok) {
      setClip(result.error, "err");
      return;
    }
    previous = before;
    transcriptText = result.text;
    askOpen = false;
    question = "";
    // copyToClipboard sets the clip status line to the "on clipboard" message.
    void copyToClipboard(result.text);
  }

  function undo() {
    if (previous === null) return;
    transcriptText = previous;
    previous = null;
    void copyToClipboard(transcriptText);
  }

  // ---- Saved prompts (reusable snippets) ----
  // A saved snippet drops into the transcript in one tap, stashing whatever was
  // there into the same "previous" slot Undo uses, and lands on the clipboard.
  // Chips are gated like the AI chips: idle only, never mid-recording/action.
  const savedUsable = $derived(!listening && !running);

  function usePrompt(prompt: SavedPrompt) {
    if (!savedUsable) return;
    previous = transcriptText;
    transcriptText = prompt.text;
    void copyToClipboard(prompt.text);
  }

  // The inline "name it" row, mirroring the askOpen interaction: prefilled from
  // the text, confirm runs the shared validator, error shows on the clip line.
  let saveOpen = $state(false);
  let saveName = $state("");

  function openSave() {
    if (!transcriptText.trim()) return;
    saveName = suggestPromptName(transcriptText);
    saveOpen = true;
  }

  async function confirmSave() {
    const result = sanitizeSavedPrompt(
      { name: saveName, text: transcriptText },
      settings.savedPrompts,
    );
    if (!result.ok) {
      setClip(result.error, "err");
      return;
    }
    settings = {
      ...settings,
      savedPrompts: [...(settings.savedPrompts ?? []), result.prompt],
    };
    if (hasChrome) await saveSettings($state.snapshot(settings));
    saveOpen = false;
    saveName = "";
    setClip("Saved — tap it in the Saved row anytime", "ok");
  }

  // manual edits re-copy after a beat
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  function onEdit() {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => void copyToClipboard(transcriptText), 600);
  }

  function onKeydown(e: KeyboardEvent) {
    if (
      e.code === "Space" &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target instanceof HTMLInputElement)
    ) {
      e.preventDefault();
      toggle();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="flex h-screen min-w-[320px] flex-col gap-3 bg-stage p-4 pb-3.5 font-sans text-ink">
  <div class="flex items-center justify-between">
    <div class="text-[17px] font-bold tracking-tight">
      Bobby <span class="brand-lite">Speak</span>
    </div>
    <div class="text-[12.5px] font-semibold text-lite">Pop-out — paste anywhere</div>
  </div>

  <div class="flex items-center gap-3.5">
    <div class="relative h-24 w-24 shrink-0">
      <svg
        class="tick-ring absolute inset-0"
        class:spin={listening}
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="48" cy="48" r="46"
          stroke={listening ? "#E8620A" : "#A6A9B5"}
          stroke-width="2.2" stroke-linecap="round"
          stroke-dasharray="0.1 11.9" opacity={listening ? "0.9" : "0.75"}
        />
      </svg>
      {#if listening}
        <span class="rec-dot absolute -top-px left-1/2 z-[3] h-2 w-2 -translate-x-1/2 rounded-full bg-accent"></span>
      {/if}
      <div class="orb" class:fast={listening} aria-hidden="true">
        <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      </div>
      <button
        class="absolute inset-1.5 z-[2] cursor-pointer rounded-full bg-transparent"
        aria-label="Start or stop dictation"
        onclick={toggle}
      ></button>
    </div>
    <div class="min-w-0">
      <div class="text-[15px] font-bold tracking-tight">{statusTitle}</div>
      <div class="mt-0.5 text-xs text-grey">{statusSub}</div>
      <div class="mt-2 flex h-4 items-end gap-[3px]" aria-hidden="true">
        {#each levels as level, i (i)}
          <i
            class="block w-[3px] rounded-sm transition-[height] duration-100"
            class:bg-accent={listening}
            class:bg-grey={!listening}
            style="height: {Math.max(4, Math.round(level * 16))}px"
          ></i>
        {/each}
      </div>
    </div>
  </div>

  <!-- Saved prompts: one-tap snippets, shown only when the library has any. -->
  {#if settings.savedPrompts?.length}
    <div class="flex shrink-0 items-center gap-2">
      <span class="shrink-0 text-[11px] font-bold uppercase tracking-wider text-grey">Saved</span>
      <div class="chips-row flex gap-1.5 overflow-x-auto">
        {#each settings.savedPrompts as prompt (prompt.id)}
          <button
            class="shrink-0 rounded-lg bg-panel px-2 py-0.5 text-[11px] font-semibold text-grey transition-transform active:scale-95"
            disabled={!savedUsable}
            style={!savedUsable ? "opacity:.45" : ""}
            title={prompt.text}
            onclick={() => usePrompt(prompt)}
          >{prompt.name}</button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col rounded-[22px] bg-screen px-3.5 pb-3 pt-3.5 shadow-sm">
    <h2 class="mb-2 shrink-0 text-[13px] font-bold uppercase tracking-wider text-grey">
      Transcript
    </h2>
    <textarea
      class="min-h-0 w-full flex-1 resize-none bg-transparent p-0 text-sm leading-relaxed outline-none placeholder:text-lite"
      placeholder="Speak, and cleaned-up text collects here — already copied, so just {pasteKey} into any app."
      spellcheck="true"
      bind:value={transcriptText}
      oninput={onEdit}
    ></textarea>
    <div class="min-h-[18px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-grey">
      {tentative ? "… " + tentative : ""}
    </div>
  </div>

  <!-- AI text actions -->
  <div class="shrink-0">
    {#if askOpen}
      <div class="mb-2 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-xl border border-line bg-face px-3 py-2 text-sm outline-none placeholder:text-lite"
          placeholder="Ask about this text…"
          bind:value={question}
          onkeydown={(e) => e.key === "Enter" && applyAction(askAction)}
        />
        <button
          class="pillbtn-dark pillbtn shrink-0"
          onclick={() => applyAction(askAction)}
          disabled={!!running}
        >
          {running === "ask" ? "…" : "Go"}
        </button>
        <button
          class="pillbtn shrink-0"
          aria-label="Close question"
          onclick={() => { askOpen = false; question = ""; }}
        >✕</button>
      </div>
    {/if}

    {#if saveOpen}
      <div class="mb-2 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-xl border border-line bg-face px-3 py-2 text-sm outline-none placeholder:text-lite"
          placeholder="Name this prompt…"
          maxlength="24"
          bind:value={saveName}
          onkeydown={(e) => e.key === "Enter" && confirmSave()}
        />
        <button class="pillbtn-dark pillbtn shrink-0" onclick={confirmSave}>Save</button>
        <button
          class="pillbtn shrink-0"
          aria-label="Close save"
          onclick={() => { saveOpen = false; saveName = ""; }}
        >✕</button>
      </div>
    {/if}

    <!-- Tone: a slim row of pills; the pick persists the moment you tap it. -->
    <div class="mb-2 flex items-center gap-1.5">
      {#each TONES as t (t.id)}
        <button
          class="rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors"
          class:bg-accent={settings.tone === t.id}
          class:text-face={settings.tone === t.id}
          class:bg-panel={settings.tone !== t.id}
          class:text-grey={settings.tone !== t.id}
          title="Tone for Clean, Sharpen and custom chips"
          onclick={() => setTone(t.id)}
        >{t.label}</button>
      {/each}
    </div>

    <div class="chips-row flex gap-2 overflow-x-auto">
      {#each actions as action (action.id)}
        <button
          class="shrink-0 rounded-xl bg-face px-3 py-1.5 text-[12.5px] font-semibold shadow-sm transition-transform active:scale-95"
          class:ring-2={askOpen && action.needsQuestion}
          class:ring-accent={askOpen && action.needsQuestion}
          disabled={!!running || (!chipUsable && !action.needsQuestion)}
          style={!!running || (!chipUsable && !action.needsQuestion) ? "opacity:.45" : ""}
          title={action.hint}
          onclick={() => applyAction(action)}
        >
          {running === action.id ? "Working…" : action.label}
        </button>
      {/each}

      {#if previous !== null}
        <button
          class="shrink-0 rounded-xl bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-grey transition-transform active:scale-95"
          onclick={undo}
        >↩ Undo</button>
      {/if}

      <button
        class="shrink-0 rounded-xl bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-grey transition-transform active:scale-95"
        title="Customize chips in Settings"
        aria-label="Customize chips"
        onclick={openOptions}
      >＋</button>
    </div>
  </div>

  <div class="flex shrink-0 items-center justify-between gap-2.5">
    <span
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs"
      class:text-grey={clipTone === "idle"}
      class:font-semibold={clipTone !== "idle"}
      class:text-green-700={clipTone === "ok"}
      class:text-red-700={clipTone === "err"}
    >{clipMessage}</span>
    <span class="flex shrink-0 gap-2">
      <button class="pillbtn" onclick={clearAll}>Clear</button>
      <button
        class="pillbtn"
        disabled={!transcriptText.trim()}
        style={!transcriptText.trim() ? "opacity:.45" : ""}
        onclick={openSave}
      >Save</button>
      <button class="pillbtn" onclick={() => copyToClipboard(transcriptText, false)}>Copy</button>
      <button class="pillbtn-dark pillbtn" onclick={toggle}>
        {listening ? "Stop" : "Start"}
      </button>
    </span>
  </div>
</main>

<style>
  /* Chips scroll sideways when they outgrow the row; hide the scrollbar so the
     row stays as clean as the rest of the Air OS surface. */
  .chips-row {
    scrollbar-width: none;
  }
  .chips-row::-webkit-scrollbar {
    display: none;
  }
  .orb {
    position: absolute;
    inset: 6px;
    border-radius: 50%;
    background: #ebebf1;
    overflow: hidden;
    box-shadow:
      inset 0 0 0 1px rgba(20, 20, 30, 0.05),
      0 16px 34px -16px rgba(40, 42, 60, 0.4);
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(10px);
  }
  .b1 {
    width: 62%; height: 60%; left: 8%; top: 16%;
    background: radial-gradient(circle at 45% 40%, #9a9cab, #c2c4cf 70%, transparent 82%);
    animation: drift1 12s ease-in-out infinite alternate;
  }
  .b2 {
    width: 48%; height: 48%; right: 2%; top: 30%;
    background: radial-gradient(circle at 55% 45%, #8b8d9c, transparent 72%);
    opacity: 0.85;
    animation: drift2 16s ease-in-out infinite alternate;
  }
  .b3 {
    width: 55%; height: 42%; left: 16%; bottom: -6%;
    background: radial-gradient(circle at 50% 50%, #fbfbfd, transparent 75%);
    animation: drift1 14s ease-in-out infinite alternate-reverse;
  }
  .orb.fast .blob {
    animation-duration: 3s;
  }
  /* Recording state: the same elements, just awake — the tick ring turns
     accent and crawls, the dot breathes, and the orb gets a soft warm halo. */
  .orb.fast {
    box-shadow:
      inset 0 0 0 1px rgba(20, 20, 30, 0.05),
      0 16px 34px -16px rgba(40, 42, 60, 0.4),
      0 0 0 1.5px rgba(232, 98, 10, 0.22),
      0 0 26px -6px rgba(232, 98, 10, 0.45);
  }
  .tick-ring {
    transform-origin: center;
  }
  .tick-ring.spin {
    animation: ringcrawl 24s linear infinite;
  }
  @keyframes ringcrawl {
    to { transform: rotate(360deg); }
  }
  .rec-dot {
    animation: recpulse 1.6s ease-in-out infinite;
  }
  @keyframes recpulse {
    0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
    50% { opacity: 0.35; transform: translateX(-50%) scale(0.8); }
  }
  @keyframes drift1 {
    from { transform: translate(0, 0); }
    to { transform: translate(7%, -5%); }
  }
  @keyframes drift2 {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(-6%, 5%) scale(1.07); }
  }
  @media (prefers-reduced-motion: reduce) {
    .blob, .tick-ring.spin, .rec-dot { animation: none; }
  }
</style>
