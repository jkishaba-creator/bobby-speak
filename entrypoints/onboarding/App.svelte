<script lang="ts">
  // First-run onboarding. Opens automatically on install so every permission
  // and check happens UP FRONT — by the time the user is on a real website,
  // dictation just works. Three steps: mic, shortcut, try it.

  import { startDictation, type DictationSession } from "../../src/pipeline";
  import { getSettings } from "../../src/shared/settings";
  import { DEFAULT_SETTINGS, type Settings } from "../../src/shared/types";

  const hasChrome =
    typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  const isMac = navigator.platform.toLowerCase().includes("mac");

  // ---- step 1: microphone ----
  let micState: "unknown" | "granted" | "denied" | "prompt" = $state("unknown");

  async function refreshMicState() {
    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      micState = status.state as typeof micState;
      status.onchange = () => (micState = status.state as typeof micState);
    } catch {
      micState = "prompt";
    }
  }
  void refreshMicState();

  async function enableMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micState = "granted";
    } catch {
      micState = "denied";
    }
  }

  // ---- step 2: shortcut ----
  let shortcut = $state(isMac ? "⌘⇧1" : "Ctrl+Shift+1");
  let shortcutBound = $state(true);
  if (hasChrome && chrome.commands?.getAll) {
    chrome.commands.getAll((commands) => {
      const cmd = commands.find((c) => c.name === "dictate-from-anywhere");
      if (cmd?.shortcut) {
        shortcut = cmd.shortcut;
        shortcutBound = true;
      } else if (cmd) {
        shortcutBound = false;
      }
    });
  }

  // ---- step 3: try it right here ----
  let listening = $state(false);
  let tryText = $state("");
  let tentative = $state("");
  let tried = $state(false);
  let session: DictationSession | null = null;

  async function toggleTry() {
    if (listening) {
      await session?.stop();
      return;
    }
    const settings: Settings = hasChrome
      ? await getSettings()
      : { ...DEFAULT_SETTINGS };
    session = startDictation(settings);
    listening = true;
    session.events.subscribe((event) => {
      switch (event.type) {
        case "text":
          tryText = event.committed;
          tentative = event.tentative;
          break;
        case "done":
          listening = false;
          tentative = "";
          if (event.transcript) {
            tryText = event.transcript;
            tried = true;
          }
          session = null;
          break;
        case "mic-denied":
          listening = false;
          micState = "denied";
          session = null;
          break;
        case "error":
          listening = false;
          tentative = "";
          tryText = "⚠ " + event.message;
          session = null;
          break;
      }
    });
  }

  const steps = $derived.by(() => [
    micState === "granted",
    shortcutBound,
    tried,
  ]);
</script>

<main class="min-h-screen bg-stage px-6 pb-16 pt-12 font-sans text-ink">
  <div class="mx-auto flex max-w-[560px] flex-col gap-5">
    <header class="text-center">
      <div class="text-2xl font-bold tracking-tight">
        Bobby <span class="text-lite">Speak</span>
      </div>
      <p class="mt-2 text-[15px] text-grey">
        Voice dictation for your browser — and beyond. Three quick things and
        you're set for good.
      </p>
    </header>

    <!-- Step 1: microphone -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="font-bold">
            <span class="mr-1.5 font-mono text-[13px] text-accent">1</span>
            Allow the microphone
          </h2>
          <p class="mt-1 text-[13px] text-grey">
            Chrome asks once, here — never again on individual sites. Audio
            goes only to the speech engine you choose, nowhere else.
          </p>
        </div>
        {#if micState === "granted"}
          <span class="shrink-0 rounded-full bg-green-100 px-3 py-1 text-[12.5px] font-bold text-green-800">Granted ✓</span>
        {:else if micState === "denied"}
          <span class="shrink-0 rounded-full bg-red-100 px-3 py-1 text-[12.5px] font-bold text-red-800">Blocked</span>
        {:else}
          <button class="pillbtn pillbtn-dark shrink-0" onclick={enableMic}>Allow mic</button>
        {/if}
      </div>
      {#if micState === "denied"}
        <p class="mt-2 rounded-lg bg-panel px-3 py-2 text-[12.5px] text-grey">
          Blocked before? Click the 🎤 icon in the address bar of this tab,
          choose Allow, then reload this page.
        </p>
      {/if}
    </section>

    <!-- Step 2: shortcut -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="font-bold">
            <span class="mr-1.5 font-mono text-[13px] text-accent">2</span>
            Your one shortcut
          </h2>
          <p class="mt-1 text-[13px] text-grey">
            <span class="rounded-lg border border-line bg-face px-2 py-0.5 font-mono text-xs font-semibold">{shortcut}</span>
            starts and stops dictation everywhere — on web pages, and even
            while you're in another app (your words land on the clipboard,
            ready to paste).
          </p>
        </div>
        {#if shortcutBound}
          <span class="shrink-0 rounded-full bg-green-100 px-3 py-1 text-[12.5px] font-bold text-green-800">Ready ✓</span>
        {:else}
          <button
            class="pillbtn shrink-0"
            onclick={() => hasChrome && chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
          >Fix binding</button>
        {/if}
      </div>
      {#if !shortcutBound}
        <p class="mt-2 rounded-lg bg-panel px-3 py-2 text-[12.5px] text-grey">
          Another app grabbed the key. In the page that opens, give
          “Start / stop dictation” a Ctrl/⌘+Shift+number key and set its
          scope to <b>Global</b>.
        </p>
      {/if}
    </section>

    <!-- Step 3: try it -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="font-bold">
        <span class="mr-1.5 font-mono text-[13px] text-accent">3</span>
        Say something
      </h2>
      <div class="mt-3 flex items-start gap-3">
        <button
          class="pillbtn shrink-0"
          class:pillbtn-dark={!listening}
          disabled={micState !== "granted"}
          style={micState !== "granted" ? "opacity:.5;cursor:not-allowed" : ""}
          onclick={toggleTry}
        >
          {listening ? "◼ Stop" : "● Start"}
        </button>
        <div class="min-h-[64px] w-full rounded-xl border border-line bg-face px-3.5 py-2.5 text-sm leading-relaxed">
          {#if tryText || tentative}
            {tryText}<span class="text-grey">{tentative ? " " + tentative : ""}</span>
          {:else}
            <span class="text-lite">
              {micState === "granted"
                ? listening
                  ? "Listening — try “hello world, this is my first dictation”"
                  : "Click Start and talk. Your words appear here, cleaned up."
                : "Finish step 1 first."}
            </span>
          {/if}
        </div>
      </div>
      {#if tried}
        <p class="mt-2 text-[13px] font-semibold text-green-800">
          That's it — you're fully set up. Close this tab and dictate anywhere with {shortcut}.
        </p>
      {/if}
    </section>

    <footer class="text-center text-xs leading-relaxed text-lite">
      {steps.filter(Boolean).length}/3 complete · Works out of the box with
      Chrome's speech engine — switch to Whisper or Deepgram Flux any time in
      Settings. No account, no telemetry; transcripts stay on this device.
    </footer>
  </div>
</main>
