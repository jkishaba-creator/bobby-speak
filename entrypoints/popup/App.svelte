<script lang="ts">
  // The v1 popup, rebuilt as a Svelte component. Same Air OS look: cloud orb
  // with dotted tick ring as the mic button, last transcription, pill footer.

  let phase: "idle" | "listening" | "processing" = $state("idle");
  let lastText = $state("");
  let shortcut = $state(
    navigator.platform.toLowerCase().includes("mac") ? "⌘⇧Space" : "Ctrl+Shift+Space",
  );
  let shortcutMissing = $state(false);
  let copied = $state(false);

  const hasChrome =
    typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;

  if (hasChrome) {
    chrome.runtime.sendMessage({ target: "background", type: "get-state" }, (res) => {
      if (!chrome.runtime.lastError && res) phase = res.state;
    });
    chrome.runtime.onMessage.addListener((msg: any) => {
      if (msg?.target === "popup" && msg.type === "state-changed") phase = msg.state;
    });
    chrome.storage.local.get(["lastTranscript"]).then((d) => {
      lastText = d.lastTranscript ?? "";
    });
    // Show the truth about the shortcut, not the assumption — Chrome silently
    // refuses to bind keys another extension holds.
    chrome.commands.getAll((commands) => {
      const toggle = commands.find((c) => c.name === "toggle-dictation");
      if (toggle?.shortcut) shortcut = toggle.shortcut;
      else if (toggle) shortcutMissing = true;
    });
  }

  function toggle() {
    if (hasChrome) {
      chrome.runtime.sendMessage({ target: "background", type: "toggle" }).catch(() => {});
    }
  }

  function openShortcuts() {
    if (hasChrome) chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  function copyLast() {
    if (!lastText) return;
    navigator.clipboard.writeText(lastText).then(() => {
      copied = true;
      setTimeout(() => (copied = false), 1200);
    });
  }

  const statusTitle = $derived.by(() => {
    switch (phase) {
      case "listening":
        return "Listening…";
      case "processing":
        return "Processing…";
      default:
        return "Click the orb to dictate";
    }
  });
</script>

<main class="w-[344px] bg-stage p-[18px] pb-4 font-sans text-ink">
  <div class="mb-1.5 flex items-center justify-between">
    <div class="text-[17px] font-bold tracking-tight">
      Bobby <span class="brand-lite">Speak</span>
    </div>
    <div class="text-[13px] font-semibold text-lite">Dictate</div>
  </div>

  <div class="py-2">
    <div class="relative mx-auto h-[190px] w-[190px]">
      <svg class="absolute inset-0" viewBox="0 0 190 190" fill="none" aria-hidden="true">
        <circle
          cx="95" cy="95" r="92"
          stroke="#A6A9B5" stroke-width="2.6" stroke-linecap="round"
          stroke-dasharray="0.1 12.85" opacity="0.75"
        />
      </svg>
      {#if phase === "listening"}
        <span
          class="absolute left-1/2 top-0.5 z-[3] h-2 w-2 -translate-x-1/2 rounded-full bg-accent"
        ></span>
      {/if}
      <div class="orb" class:fast={phase === "listening"} aria-hidden="true">
        <div class="blob b1"></div>
        <div class="blob b2"></div>
        <div class="blob b3"></div>
      </div>
      <button
        class="absolute inset-[10px] z-[2] cursor-pointer rounded-full bg-transparent"
        aria-label="Start or stop dictation"
        onclick={toggle}
      ></button>
    </div>
    <div class="mt-3 text-center">
      <div class="text-[15px] font-bold">{statusTitle}</div>
      {#if phase === "idle"}
        <div class="mt-0.5 text-xs text-grey">
          or press <span class="kbd">{shortcut}</span> on any page
        </div>
      {/if}
    </div>
  </div>

  {#if shortcutMissing}
    <div
      class="mt-3.5 flex items-center gap-2.5 rounded-[10px] border-l-[3px] border-accent bg-screen px-3.5 py-2.5 text-[12.5px]"
    >
      <div class="flex-1">
        <b class="block text-[13px]">Keyboard shortcut isn't set</b>
        <span class="text-grey">Chrome didn't bind it — one click to fix.</span>
      </div>
      <button class="pillbtn" onclick={openShortcuts}>Fix</button>
    </div>
  {/if}

  <div class="mt-3.5 rounded-[22px] bg-screen px-4 py-3.5 shadow-sm">
    <h2 class="text-[13px] font-bold uppercase tracking-wider text-grey">
      Last transcription
    </h2>
    <p class="mt-1.5 line-clamp-3 min-h-[19px] text-[13px]" class:text-lite={!lastText}>
      {lastText || "Nothing yet — try dictating into any text field."}
    </p>
    <div class="mt-2.5 flex justify-end">
      <button
        class="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-face shadow-md transition-transform active:scale-90"
        aria-label="Copy last transcription"
        onclick={copyLast}
      >
        {#if copied}<span class="text-[11px] font-bold text-accent">✓</span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="4.5" y="4.5" width="8" height="8" rx="2" />
            <path d="M10.5 5.5v-1a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1" />
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <div class="mt-3.5 flex items-center gap-2">
    <button class="pillbtn" onclick={() => hasChrome && chrome.runtime.openOptionsPage()}>
      Settings
    </button>
    <button class="pillbtn-dark pillbtn ml-auto" onclick={toggle}>
      {phase === "listening" ? "Stop" : "Start"}
    </button>
  </div>
</main>

<style>
  .kbd {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    background: var(--color-face);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    padding: 3px 9px;
  }
  .orb {
    position: absolute;
    inset: 10px;
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
    filter: blur(14px);
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
    animation-duration: 3.5s;
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
