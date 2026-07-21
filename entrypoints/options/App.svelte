<script lang="ts">
  // v1's settings page, ported to Svelte. Same Air OS panels, same settings
  // keys — upgrading from v1 keeps every preference.
  import { getSettings, saveSettings } from "../../src/shared/settings";
  import { DEFAULT_SETTINGS, type EngineId, type Settings } from "../../src/shared/types";

  const hasChrome =
    typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;

  let settings: Settings = $state({ ...DEFAULT_SETTINGS });
  let chipInput = $state("");
  let testStatus = $state("");
  let testOk = $state(false);
  let history: Array<{ text: string; ts: number }> = $state([]);

  const isMac = navigator.platform.toLowerCase().includes("mac");
  let shortcut = $state(isMac ? "⌘⇧1" : "Ctrl+Shift+1");

  const ENGINES: Array<{ id: EngineId; name: string; badge: string; hint: string }> = [
    { id: "chrome", name: "Chrome built-in", badge: "free",
      hint: "Works instantly, no setup — Chrome's own speech service" },
    { id: "cf-whisper", name: "Whisper large-v3-turbo", badge: "cloudflare",
      hint: "Best accuracy; transcribes when you stop. BYO Cloudflare account." },
    { id: "cf-flux", name: "Deepgram Flux", badge: "cloudflare · streaming",
      hint: "Live streaming text with smart end-of-phrase detection. Needs an AI Gateway." },
  ];

  const LANGUAGES = [
    ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Español"],
    ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["pt-BR", "Português (BR)"],
    ["ja-JP", "日本語"], ["ko-KR", "한국어"], ["zh-CN", "中文（简体）"], ["hi-IN", "हिन्दी"],
  ];

  if (hasChrome) {
    getSettings().then((s) => (settings = s));
    chrome.storage.local.get("history").then((d) => (history = d.history ?? []));
    chrome.commands.getAll((commands) => {
      const t = commands.find((c) => c.name === "dictate-from-anywhere");
      if (t?.shortcut) shortcut = t.shortcut;
    });
  }

  function persist() {
    if (hasChrome) void saveSettings($state.snapshot(settings));
  }

  function addWord(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    const word = chipInput.trim().replace(/\s+/g, "");
    if (!word) return;
    if (!settings.customWords.some((w) => w.toLowerCase() === word.toLowerCase())) {
      settings.customWords = [...settings.customWords, word];
      persist();
    }
    chipInput = "";
  }

  function removeWord(i: number) {
    settings.customWords = settings.customWords.filter((_, idx) => idx !== i);
    persist();
  }

  async function testConnection() {
    testOk = false;
    if (!settings.cfAccountId || !settings.cfApiToken) {
      testStatus = "Enter Account ID and token first";
      return;
    }
    testStatus = "Testing…";
    try {
      const resp = await fetch(
        "https://api.cloudflare.com/client/v4/accounts/" +
          encodeURIComponent(settings.cfAccountId) +
          "/ai/models/search?search=whisper",
        { headers: { Authorization: "Bearer " + settings.cfApiToken } },
      );
      const json = await resp.json();
      if (json.success) {
        testStatus = "Connected ✓";
        testOk = true;
      } else {
        testStatus = json.errors?.[0]?.message ?? "Rejected";
      }
    } catch {
      testStatus = "Network error";
    }
  }

  function clearHistory() {
    if (hasChrome) void chrome.storage.local.remove(["history", "lastTranscript"]);
    history = [];
  }

  const needsCloudflare = $derived(settings.engine !== "chrome");

  // Smart-formatting picker: one control over the aiPolish master switch plus
  // the polishProvider engine choice.
  const polishChoice = $derived(
    settings.aiPolish === false ? "off" : settings.polishProvider,
  );
  function setPolish(choice: string) {
    if (choice === "off") {
      settings.aiPolish = false;
    } else {
      settings.aiPolish = true;
      settings.polishProvider = choice as "chrome" | "cloudflare";
    }
    persist();
  }
</script>

<main class="min-h-screen bg-stage px-6 pb-16 pt-10 font-sans text-ink">
  <div class="mx-auto flex max-w-[620px] flex-col gap-[18px]">
    <header class="mb-1.5 flex items-baseline justify-between">
      <h1 class="text-2xl font-bold tracking-tight">
        Bobby <span class="text-lite">Speak</span>
      </h1>
      <span class="font-semibold text-lite">Settings</span>
    </header>

    <!-- Speech engine -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">
        Speech engine
      </h2>
      {#each ENGINES as engine (engine.id)}
        <button
          class="flex w-full items-center justify-between gap-3.5 border-b border-line py-3 text-left last:border-b-0"
          aria-pressed={settings.engine === engine.id}
          onclick={() => { settings.engine = engine.id; persist(); }}
        >
          <span>
            <span class="font-semibold">
              {engine.name}
              <span class="ml-2 rounded border border-line bg-face px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-grey">
                {engine.badge}
              </span>
            </span>
            <span class="mt-0.5 block text-[12.5px] text-grey">{engine.hint}</span>
          </span>
          <span
            class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line bg-face"
          >
            {#if settings.engine === engine.id}
              <span class="h-2 w-2 rounded-full bg-accent"></span>
            {/if}
          </span>
        </button>
      {/each}

      {#if needsCloudflare}
        <div class="mt-1 border-t border-line pt-1">
          <label class="flex items-center justify-between gap-3.5 border-b border-line py-3">
            <span>
              <span class="font-semibold">Account ID</span>
              <span class="mt-0.5 block text-[12.5px] text-grey">Cloudflare dash → right sidebar</span>
            </span>
            <input
              class="w-[240px] max-w-[50vw] rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
              placeholder="32-character hex id" spellcheck="false"
              bind:value={settings.cfAccountId} onchange={persist}
            />
          </label>
          <label class="flex items-center justify-between gap-3.5 border-b border-line py-3">
            <span>
              <span class="font-semibold">API token</span>
              <span class="mt-0.5 block text-[12.5px] text-grey">Needs Workers AI permission — stored only in your browser</span>
            </span>
            <input
              type="password" class="w-[240px] max-w-[50vw] rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
              placeholder="token" bind:value={settings.cfApiToken} onchange={persist}
            />
          </label>
          {#if settings.engine === "cf-flux"}
            <label class="flex items-center justify-between gap-3.5 border-b border-line py-3">
              <span>
                <span class="font-semibold">AI Gateway name</span>
                <span class="mt-0.5 block text-[12.5px] text-grey">Flux only — create one free: dash → AI → AI Gateway</span>
              </span>
              <input
                class="w-[240px] max-w-[50vw] rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
                placeholder="my-gateway" spellcheck="false"
                bind:value={settings.cfGateway} onchange={persist}
              />
            </label>
          {/if}
          <div class="flex items-center justify-between gap-3.5 py-3">
            <span>
              <span class="font-semibold">Connection</span>
              <span class="mt-0.5 block text-[12.5px] font-semibold" class:text-green-700={testOk}>
                {testStatus}
              </span>
            </span>
            <button class="pillbtn" onclick={testConnection}>Test connection</button>
          </div>
        </div>
      {/if}
    </section>

    <!-- General -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">General</h2>

      <label class="flex items-center justify-between gap-3.5 border-b border-line py-3">
        <span>
          <span class="font-semibold">Language</span>
          <span class="mt-0.5 block text-[12.5px] text-grey">Speech recognition language</span>
        </span>
        <select
          class="rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          bind:value={settings.language} onchange={persist}
        >
          {#each LANGUAGES as [code, label] (code)}
            <option value={code}>{label}</option>
          {/each}
        </select>
      </label>

      {#each [
        { key: "removeFillers" as const, name: "Remove filler words", hint: "Drops “um”, “uh”, repeated words" },
        { key: "spokenPunctuation" as const, name: "Spoken punctuation", hint: "Saying “period”, “comma”, “new line” types it" },
      ] as row (row.key)}
        <div class="flex items-center justify-between gap-3.5 border-b border-line py-3">
          <span>
            <span class="font-semibold">{row.name}</span>
            <span class="mt-0.5 block text-[12.5px] text-grey">{row.hint}</span>
          </span>
          <!-- Knob position is layout-driven (flex), not transform-driven, so it
               is correct even if the colour transition never runs. -->
          <button
            role="switch" aria-checked={settings[row.key]} aria-label={row.name}
            class="flex h-[23px] w-10 shrink-0 items-center rounded-full px-[2.5px] transition-colors"
            class:justify-end={settings[row.key]}
            class:bg-accent={settings[row.key]}
            class:bg-line={!settings[row.key]}
            onclick={() => { settings[row.key] = !settings[row.key]; persist(); }}
          >
            <span class="h-[18px] w-[18px] rounded-full bg-white shadow"></span>
          </button>
        </div>
      {/each}

      <label class="flex items-center justify-between gap-3.5 py-3">
        <span>
          <span class="font-semibold">History limit</span>
          <span class="mt-0.5 block text-[12.5px] text-grey">Kept only on this device, never synced. Set to 0 to keep nothing at all.</span>
        </span>
        <input
          type="number" min="0" max="500" step="5"
          class="w-[84px] rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          bind:value={settings.historyLimit} onchange={persist}
        />
      </label>
    </section>

    <!-- Smart formatting -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">
        Smart formatting
      </h2>
      <p class="text-[12.5px] text-grey">
        An AI pass that punctuates and capitalizes by grammar — so you can just
        talk, without saying “comma” or “period”.
      </p>
      {#each [
        { id: "off", name: "Off", hint: "Rule-based cleanup only — fastest, works everywhere" },
        { id: "chrome", name: "On-device (Chrome)", hint: "Free and private, but needs a capable machine + a one-time model download" },
        { id: "cloudflare", name: "Cloudflare", hint: "Best quality on any machine — uses your Cloudflare account (same as the engines above)" },
      ] as opt (opt.id)}
        <button
          class="flex w-full items-center justify-between gap-3.5 border-b border-line py-3 text-left last:border-b-0"
          aria-pressed={polishChoice === opt.id}
          onclick={() => setPolish(opt.id)}
        >
          <span>
            <span class="font-semibold">{opt.name}</span>
            <span class="mt-0.5 block text-[12.5px] text-grey">{opt.hint}</span>
          </span>
          <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line bg-face">
            {#if polishChoice === opt.id}
              <span class="h-2 w-2 rounded-full bg-accent"></span>
            {/if}
          </span>
        </button>
      {/each}

      {#if polishChoice === "cloudflare"}
        <div class="mt-1 border-t border-line pt-1">
          <label class="flex items-center justify-between gap-3.5 py-3">
            <span>
              <span class="font-semibold">Formatting model</span>
              <span class="mt-0.5 block text-[12.5px] text-grey">
                A Workers AI text model. The default is fast and cheap; larger
                models format better.
              </span>
            </span>
            <select
              class="max-w-[55vw] rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
              bind:value={settings.cfTextModel} onchange={persist}
            >
              <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (best)</option>
              <option value="@cf/mistralai/mistral-small-3.1-24b-instruct">Mistral Small 24B (balanced)</option>
              <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (fastest)</option>
            </select>
          </label>
          {#if !settings.cfAccountId || !settings.cfApiToken}
            <p class="rounded-lg bg-panel px-3 py-2 text-[12.5px] text-grey">
              Add your Cloudflare Account ID and API token in the
              <b>Speech engine</b> section above — the same credentials power
              formatting.
            </p>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Custom words -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">Custom words</h2>
      <p class="text-[12.5px] text-grey">
        Names and jargon the engine gets wrong — near-misses are auto-corrected to these spellings.
      </p>
      <div class="mt-2.5 flex flex-col gap-2.5">
        <div class="flex flex-wrap gap-[7px]">
          {#each settings.customWords as word, i (word)}
            <span class="inline-flex items-center gap-1.5 rounded-full bg-face py-1 pl-3 pr-2 text-[12.5px] font-semibold shadow-sm">
              {word}
              <button
                class="grid h-[17px] w-[17px] place-items-center rounded-full bg-panel text-[11px] text-grey hover:text-ink"
                aria-label={"Remove " + word} onclick={() => removeWord(i)}
              >✕</button>
            </span>
          {:else}
            <span class="py-2 text-[13px] text-lite">No custom words yet.</span>
          {/each}
        </div>
        <input
          class="w-full rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          placeholder="Type a word and press Enter" maxlength="50"
          bind:value={chipInput} onkeydown={addWord}
        />
      </div>
    </section>

    <!-- Shortcut -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">Keyboard shortcut</h2>
      <div class="flex items-center justify-between gap-3.5 border-b border-line py-3">
        <span>
          <span class="font-semibold">Start / stop dictation</span>
          <span class="mt-0.5 block text-[12.5px] text-grey">One shortcut everywhere — web pages, the pop-out, and other apps (via clipboard)</span>
        </span>
        <span class="rounded-lg border border-line bg-face px-2.5 py-1 font-mono text-xs font-semibold">
          {shortcut}
        </span>
      </div>
      <div class="flex items-center justify-between gap-3.5 py-3">
        <span>
          <span class="font-semibold">Change it</span>
          <span class="mt-0.5 block text-[12.5px] text-grey">Chrome manages extension shortcuts</span>
        </span>
        <button
          class="pillbtn"
          onclick={() => hasChrome && chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
        >Open shortcut settings</button>
      </div>
    </section>

    <!-- History -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <div class="flex items-center justify-between">
        <h2 class="text-[13px] font-bold uppercase tracking-wider text-grey">History</h2>
        <button class="pillbtn" onclick={clearHistory}>Clear</button>
      </div>
      <div class="mt-2 flex flex-col">
        {#each history as entry (entry.ts)}
          <div class="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
            <span class="flex-1 text-[13px]">{entry.text}</span>
            <span class="whitespace-nowrap pt-0.5 font-mono text-[11px] text-grey">
              {new Date(entry.ts).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </span>
            <button
              class="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-face shadow-sm"
              aria-label="Copy transcription"
              onclick={() => navigator.clipboard.writeText(entry.text)}
            >⧉</button>
          </div>
        {:else}
          <p class="py-2 text-[13px] text-lite">Transcriptions will appear here.</p>
        {/each}
      </div>
    </section>

    <footer class="mt-2 text-center text-xs text-lite">
      Bobby Speak 2.0.0-alpha — all recognition state stays on this device or in your Chrome profile.
    </footer>
  </div>
</main>
