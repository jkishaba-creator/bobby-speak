<script lang="ts">
  // Bobby Speak on mobile. The same pipeline the extension runs — audio →
  // ASR provider → processing stages → text — wrapped in a phone-shaped
  // shell instead of a browser extension.
  //
  // The mobile flow is the pop-out flow: dictate here, the cleaned text is
  // already on your clipboard, paste into whatever app you were in.

  import { startDictation, type DictationSession } from "../src/pipeline";
  import { getSettings, saveSettings } from "../src/shared/settings";
  import { DEFAULT_SETTINGS, type EngineId, type Settings } from "../src/shared/types";

  // Chrome's Web Speech engine exists on Android Chrome but not iOS Safari,
  // so the default engine differs by device. Cloudflare works everywhere.
  const hasWebSpeech =
    typeof (globalThis as any).SpeechRecognition !== "undefined" ||
    typeof (globalThis as any).webkitSpeechRecognition !== "undefined";

  let settings: Settings = $state({ ...DEFAULT_SETTINGS });
  let loaded = $state(false);

  let listening = $state(false);
  let processing = $state(false);
  let transcript = $state("");
  let tentative = $state("");
  let levels: number[] = $state(Array(9).fill(0));
  let status = $state("Tap to speak");
  let copied = $state(false);
  let errorMsg = $state("");
  let showSettings = $state(false);

  let session: DictationSession | null = null;

  (async () => {
    const s = await getSettings();
    // First run on a device with no Web Speech (iPhone): point at Cloudflare
    // so the engine picker isn't silently set to something unusable.
    if (!hasWebSpeech && s.engine === "chrome") s.engine = "cf-whisper";
    settings = s;
    loaded = true;
  })();

  function persist() {
    void saveSettings($state.snapshot(settings));
  }

  const needsSetup = $derived(
    settings.engine !== "chrome" && (!settings.cfAccountId || !settings.cfApiToken),
  );

  async function copyOut(text: string, loud = false) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      if (loud) errorMsg = "Couldn't reach the clipboard — select the text and copy manually.";
    }
  }

  async function start() {
    errorMsg = "";
    if (needsSetup) {
      showSettings = true;
      return;
    }
    session = startDictation($state.snapshot(settings));
    listening = true;
    status = settings.engine === "cf-whisper" ? "Listening… (text arrives when you stop)" : "Listening…";

    session.events.subscribe((event) => {
      switch (event.type) {
        case "level":
          levels = event.levels;
          break;
        case "text":
          transcript = event.committed;
          tentative = event.tentative;
          break;
        case "done":
          finish();
          if (event.transcript) {
            transcript = event.transcript;
            void copyOut(event.transcript);
            status = "Copied — paste anywhere";
          } else {
            status = "Didn't catch that — tap to try again";
          }
          break;
        case "mic-denied":
          finish();
          status = "Tap to speak";
          errorMsg =
            "Microphone blocked. Allow mic access for this site in your browser settings, then reload.";
          break;
        case "error":
          finish();
          status = "Tap to speak";
          errorMsg = event.message;
          break;
      }
    });
  }

  async function stop() {
    if (!session) return;
    processing = true;
    listening = false;
    status = "Working…";
    await session.stop();
  }

  function finish() {
    listening = false;
    processing = false;
    tentative = "";
    levels = Array(9).fill(0);
    session = null;
  }

  function toggle() {
    if (listening) void stop();
    else if (!processing) void start();
  }

  function clearAll() {
    transcript = "";
    tentative = "";
    status = "Tap to speak";
    errorMsg = "";
  }
</script>

<main
  class="flex min-h-[100dvh] flex-col gap-4 bg-stage px-5 pb-6 font-sans text-ink"
  style="padding-top: max(1.25rem, env(safe-area-inset-top)); padding-bottom: max(1.5rem, env(safe-area-inset-bottom));"
>
  <!-- header -->
  <header class="flex shrink-0 items-center justify-between">
    <div class="text-[19px] font-bold tracking-tight">
      Bobby <span class="brand-lite">Speak</span>
    </div>
    <button
      class="grid h-10 w-10 place-items-center rounded-full bg-face shadow-sm active:scale-95"
      aria-label="Settings"
      onclick={() => (showSettings = true)}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 1.5v2.2M10 16.3v2.2M1.5 10h2.2M16.3 10h2.2M4 4l1.6 1.6M14.4 14.4L16 16M16 4l-1.6 1.6M5.6 14.4L4 16" />
      </svg>
    </button>
  </header>

  <!-- orb: the whole hero is the button -->
  <div class="flex shrink-0 flex-col items-center gap-3 pt-2">
    <button
      class="relative aspect-square w-[min(62vw,240px)] rounded-full active:scale-[0.98]"
      style="transition: transform .12s ease"
      aria-label={listening ? "Stop dictation" : "Start dictation"}
      aria-pressed={listening}
      onclick={toggle}
    >
      <svg class="absolute inset-0 h-full w-full" viewBox="0 0 240 240" fill="none" aria-hidden="true">
        <circle
          cx="120" cy="120" r="116"
          stroke="#A6A9B5" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="0.1 15.6" opacity="0.75"
        />
      </svg>
      {#if listening}
        <span class="absolute left-1/2 top-1 z-[3] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-accent"></span>
      {/if}
      <div class="orb" class:fast={listening} class:working={processing} aria-hidden="true">
        <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      </div>
    </button>

    <div class="flex h-5 items-end gap-[4px]" aria-hidden="true">
      {#each levels as level, i (i)}
        <i
          class="block w-[4px] rounded-sm transition-[height] duration-100"
          class:bg-accent={listening}
          class:bg-grey={!listening}
          style="height: {Math.max(5, Math.round(level * 20))}px"
        ></i>
      {/each}
    </div>

    <p class="text-center text-[15px] font-semibold" class:text-grey={!listening}>{status}</p>
  </div>

  {#if errorMsg}
    <p class="shrink-0 rounded-xl border-l-[3px] border-accent bg-screen px-3.5 py-2.5 text-[13px] text-grey">
      {errorMsg}
    </p>
  {/if}

  {#if needsSetup && loaded && !errorMsg}
    <button
      class="shrink-0 rounded-xl border-l-[3px] border-accent bg-screen px-3.5 py-2.5 text-left text-[13px] text-grey"
      onclick={() => (showSettings = true)}
    >
      <b class="block text-ink">Add your Cloudflare keys to start</b>
      This device needs a speech engine — tap to set it up (free tier, ~2 minutes).
    </button>
  {/if}

  <!-- transcript -->
  <section class="flex min-h-0 flex-1 flex-col rounded-[22px] bg-screen px-4 pb-3 pt-4 shadow-sm">
    <h2 class="mb-2 shrink-0 text-[12px] font-bold uppercase tracking-wider text-grey">
      Transcript
    </h2>
    <textarea
      class="min-h-0 w-full flex-1 resize-none bg-transparent p-0 text-[16px] leading-relaxed outline-none placeholder:text-lite"
      placeholder="Your words appear here, cleaned up and already copied."
      bind:value={transcript}
      spellcheck="true"
    ></textarea>
    {#if tentative}
      <p class="shrink-0 truncate text-[14px] text-grey">… {tentative}</p>
    {/if}
  </section>

  <!-- actions -->
  <div class="flex shrink-0 items-center gap-2.5">
    <button class="pillbtn shrink-0" onclick={clearAll}>Clear</button>
    <button
      class="pillbtn pillbtn-dark flex-1 py-3 text-[15px]"
      onclick={() => copyOut(transcript, true)}
      disabled={!transcript}
      style={!transcript ? "opacity:.45" : ""}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  </div>
</main>

<!-- settings sheet -->
{#if showSettings}
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/30"
    role="button"
    tabindex="-1"
    aria-label="Close settings"
    onclick={(e) => e.target === e.currentTarget && (showSettings = false)}
    onkeydown={(e) => e.key === "Escape" && (showSettings = false)}
  >
    <div
      class="max-h-[88dvh] overflow-y-auto rounded-t-[26px] bg-stage px-5 pb-8 pt-4"
      style="padding-bottom: max(2rem, env(safe-area-inset-bottom));"
    >
      <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-line"></div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-[19px] font-bold tracking-tight">Settings</h2>
        <button class="pillbtn" onclick={() => (showSettings = false)}>Done</button>
      </div>

      <section class="mb-4 rounded-[20px] bg-screen px-4 py-3">
        <h3 class="mb-1 text-[12px] font-bold uppercase tracking-wider text-grey">Speech engine</h3>
        {#each [
          { id: "chrome" as EngineId, name: "Built-in", hint: hasWebSpeech ? "Free, no setup — works on this device" : "Not available in this browser (try Cloudflare)" },
          { id: "cf-whisper" as EngineId, name: "Whisper", hint: "Best accuracy · needs Cloudflare keys" },
          { id: "cf-flux" as EngineId, name: "Deepgram Flux", hint: "Live streaming · needs keys + AI Gateway" },
        ] as opt (opt.id)}
          <button
            class="flex w-full items-center justify-between gap-3 border-b border-line py-3 text-left last:border-b-0"
            disabled={opt.id === "chrome" && !hasWebSpeech}
            style={opt.id === "chrome" && !hasWebSpeech ? "opacity:.45" : ""}
            onclick={() => { settings.engine = opt.id; persist(); }}
          >
            <span>
              <span class="font-semibold">{opt.name}</span>
              <span class="mt-0.5 block text-[12.5px] text-grey">{opt.hint}</span>
            </span>
            <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line bg-face">
              {#if settings.engine === opt.id}<span class="h-2 w-2 rounded-full bg-accent"></span>{/if}
            </span>
          </button>
        {/each}
      </section>

      <section class="mb-4 rounded-[20px] bg-screen px-4 py-3">
        <h3 class="mb-1 text-[12px] font-bold uppercase tracking-wider text-grey">Cloudflare</h3>
        <p class="mb-2 text-[12.5px] text-grey">
          Your own free account powers transcription and AI formatting. Keys are
          stored only on this device.
        </p>
        <label class="block border-b border-line py-2.5">
          <span class="text-[13px] font-semibold">Account ID</span>
          <input
            class="mt-1 w-full rounded-xl border border-line bg-face px-3 py-2 text-[16px]"
            placeholder="32-character hex id"
            autocomplete="off" autocapitalize="none" spellcheck="false"
            bind:value={settings.cfAccountId} onchange={persist}
          />
        </label>
        <label class="block border-b border-line py-2.5">
          <span class="text-[13px] font-semibold">API token</span>
          <input
            type="password"
            class="mt-1 w-full rounded-xl border border-line bg-face px-3 py-2 text-[16px]"
            placeholder="Workers AI token"
            autocomplete="off"
            bind:value={settings.cfApiToken} onchange={persist}
          />
        </label>
        {#if settings.engine === "cf-flux"}
          <label class="block py-2.5">
            <span class="text-[13px] font-semibold">AI Gateway name</span>
            <input
              class="mt-1 w-full rounded-xl border border-line bg-face px-3 py-2 text-[16px]"
              placeholder="my-gateway"
              autocomplete="off" autocapitalize="none" spellcheck="false"
              bind:value={settings.cfGateway} onchange={persist}
            />
          </label>
        {/if}
      </section>

      <section class="mb-4 rounded-[20px] bg-screen px-4 py-3">
        <h3 class="mb-1 text-[12px] font-bold uppercase tracking-wider text-grey">Smart formatting</h3>
        <p class="mb-2 text-[12.5px] text-grey">
          Punctuates and capitalizes by grammar, so you can just talk.
        </p>
        {#each [
          { id: "off", name: "Off", hint: "Rule-based cleanup only" },
          { id: "cloudflare", name: "Cloudflare", hint: "Best quality · uses the keys above" },
        ] as opt (opt.id)}
          <button
            class="flex w-full items-center justify-between gap-3 border-b border-line py-3 text-left last:border-b-0"
            onclick={() => {
              if (opt.id === "off") settings.aiPolish = false;
              else { settings.aiPolish = true; settings.polishProvider = "cloudflare"; }
              persist();
            }}
          >
            <span>
              <span class="font-semibold">{opt.name}</span>
              <span class="mt-0.5 block text-[12.5px] text-grey">{opt.hint}</span>
            </span>
            <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line bg-face">
              {#if (settings.aiPolish === false ? "off" : "cloudflare") === opt.id}
                <span class="h-2 w-2 rounded-full bg-accent"></span>
              {/if}
            </span>
          </button>
        {/each}
      </section>

      <p class="px-1 text-center text-[12px] leading-relaxed text-lite">
        Add to your home screen for an app-like experience. Nothing is stored on
        any server — transcripts and keys stay on this device.
      </p>
    </div>
  </div>
{/if}

<style>
  .orb {
    position: absolute;
    inset: 12px;
    border-radius: 50%;
    background: #ebebf1;
    overflow: hidden;
    box-shadow:
      inset 0 0 0 1px rgba(20, 20, 30, 0.05),
      0 20px 44px -18px rgba(40, 42, 60, 0.45);
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(18px);
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
  .orb.fast .blob { animation-duration: 3s; }
  .orb.working .blob { animation-duration: 1.4s; }
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
