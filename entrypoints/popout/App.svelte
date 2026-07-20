<script lang="ts">
  // The pop-out: dictation for OTHER apps and sites. Runs the full pipeline
  // directly in this visible window (mic access is granted to the extension
  // origin) and keeps the system clipboard preloaded with the cleaned
  // transcript as you speak — talk here, ⌘V into anything, including native
  // apps. Ported from v1; same Air OS look, v2 wiring underneath.

  import { startDictation, type DictationSession } from "../../src/pipeline";
  import { getSettings } from "../../src/shared/settings";
  import { DEFAULT_SETTINGS, type Settings } from "../../src/shared/types";

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
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let pendingCopy: string | null = null;
  let unsubscribe: (() => void) | null = null;

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
    session = startDictation(settings);
    listening = true;
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
        case "done":
          finishUi();
          if (event.transcript) {
            transcriptText = event.transcript;
            void copyToClipboard(event.transcript);
          } else if (!transcriptText) {
            setClip("Clipboard idle", "idle");
          }
          break;
        case "mic-denied":
          finishUi();
          statusTitle = "Microphone blocked";
          statusSub =
            "Allow the mic for this window (icon in the address bar), then try again.";
          break;
        case "error":
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

  function finishUi() {
    listening = false;
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
      <svg class="absolute inset-0" viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <circle
          cx="48" cy="48" r="46"
          stroke="#A6A9B5" stroke-width="2.2" stroke-linecap="round"
          stroke-dasharray="0.1 11.9" opacity="0.75"
        />
      </svg>
      {#if listening}
        <span class="absolute -top-px left-1/2 z-[3] h-2 w-2 -translate-x-1/2 rounded-full bg-accent"></span>
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
      <button class="pillbtn" onclick={() => copyToClipboard(transcriptText, false)}>Copy</button>
      <button class="pillbtn-dark pillbtn" onclick={toggle}>
        {listening ? "Stop" : "Start"}
      </button>
    </span>
  </div>
</main>

<style>
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
  @keyframes drift1 {
    from { transform: translate(0, 0); }
    to { transform: translate(7%, -5%); }
  }
  @keyframes drift2 {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(-6%, 5%) scale(1.07); }
  }
  @media (prefers-reduced-motion: reduce) {
    .blob { animation: none; }
  }
</style>
