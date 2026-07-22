<script lang="ts">
  // v1's settings page, ported to Svelte. Same Air OS panels, same settings
  // keys — upgrading from v1 keeps every preference.
  import { getSettings, saveSettings } from "../../src/shared/settings";
  import { DEFAULT_SETTINGS, type EngineId, type Settings } from "../../src/shared/types";
  import {
    TONES,
    resolveActions,
    sanitizeCustomAction,
    CUSTOM_ACTION_LIMITS,
    type TextAction,
  } from "../../src/ai/textActions";
  import {
    SAVED_PROMPT_LIMITS,
    sanitizeSavedPrompt,
  } from "../../src/shared/prompts";
  import type { SavedPrompt } from "../../src/shared/types";

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

  // --- AI action chips ----------------------------------------------------
  // Prefix the catalog puts on custom ids; matches customToTextAction.
  const CUSTOM_PREFIX = "custom-";

  // Same merge/order as resolveActions, but WITHOUT the hidden filter — the
  // editor lists every action so hidden ones can be toggled back on.
  const allActions = $derived<TextAction[]>(
    resolveActions({ ...settings, hiddenActions: [] }),
  );

  function toggleAction(id: string) {
    settings.hiddenActions = settings.hiddenActions.includes(id)
      ? settings.hiddenActions.filter((x) => x !== id)
      : [...settings.hiddenActions, id];
    persist();
  }

  // Reorder by rewriting the full id list, so the new order always persists.
  function moveAction(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= allActions.length) return;
    const ids = allActions.map((a) => a.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    settings.actionOrder = ids;
    persist();
  }

  // Add / edit form.
  let actionLabel = $state("");
  let actionPrompt = $state("");
  let actionError = $state("");
  let editingId: string | null = $state(null); // bare custom id, or null

  const atCustomLimit = $derived(
    settings.customActions.length >= CUSTOM_ACTION_LIMITS.maxCount,
  );

  function submitAction() {
    const res = sanitizeCustomAction(
      { id: editingId ?? undefined, label: actionLabel, prompt: actionPrompt },
      settings.customActions,
    );
    if (!res.ok) { actionError = res.error; return; }
    const list = settings.customActions.slice();
    const idx = list.findIndex((c) => c.id === res.action.id);
    if (idx >= 0) list[idx] = res.action;
    else list.push(res.action);
    settings.customActions = list;
    cancelEdit();
    persist();
  }

  function startEdit(action: TextAction) {
    const bareId = action.id.slice(CUSTOM_PREFIX.length);
    const c = settings.customActions.find((x) => x.id === bareId);
    if (!c) return;
    editingId = c.id;
    actionLabel = c.label;
    actionPrompt = c.prompt;
    actionError = "";
  }

  function cancelEdit() {
    editingId = null;
    actionLabel = "";
    actionPrompt = "";
    actionError = "";
  }

  function deleteCustom(action: TextAction) {
    const bareId = action.id.slice(CUSTOM_PREFIX.length);
    settings.customActions = settings.customActions.filter((c) => c.id !== bareId);
    // Drop any stale references so a reused id can't inherit old state.
    settings.hiddenActions = settings.hiddenActions.filter((x) => x !== action.id);
    settings.actionOrder = settings.actionOrder.filter((x) => x !== action.id);
    if (editingId === bareId) cancelEdit();
    persist();
  }

  // --- Saved prompts ------------------------------------------------------
  // Reusable text snippets. Same add/edit/delete shape as the AI chips above.
  let promptName = $state("");
  let promptText = $state("");
  let promptError = $state("");
  let editingPromptId: string | null = $state(null); // prompt id, or null

  const atPromptLimit = $derived(
    settings.savedPrompts.length >= SAVED_PROMPT_LIMITS.maxCount,
  );

  function submitPrompt() {
    const res = sanitizeSavedPrompt(
      { id: editingPromptId ?? undefined, name: promptName, text: promptText },
      settings.savedPrompts,
    );
    if (!res.ok) { promptError = res.error; return; }
    const list = settings.savedPrompts.slice();
    const idx = list.findIndex((p) => p.id === res.prompt.id);
    if (idx >= 0) list[idx] = res.prompt;
    else list.push(res.prompt);
    settings.savedPrompts = list;
    cancelPromptEdit();
    persist();
  }

  function startPromptEdit(prompt: SavedPrompt) {
    editingPromptId = prompt.id;
    promptName = prompt.name;
    promptText = prompt.text;
    promptError = "";
  }

  function cancelPromptEdit() {
    editingPromptId = null;
    promptName = "";
    promptText = "";
    promptError = "";
  }

  function deletePrompt(prompt: SavedPrompt) {
    settings.savedPrompts = settings.savedPrompts.filter((p) => p.id !== prompt.id);
    if (editingPromptId === prompt.id) cancelPromptEdit();
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

    <!-- AI actions -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">AI actions</h2>
      <p class="text-[12.5px] text-grey">
        The one-tap chips shown under a transcript. Reorder, hide, or add your
        own — built-ins stay put but can be hidden.
      </p>

      <!-- Tone -->
      <div class="mt-3 flex items-center justify-between gap-3.5 border-b border-line pb-3.5">
        <span>
          <span class="font-semibold">Tone</span>
          <span class="mt-0.5 block text-[12.5px] text-grey">Applied to Clean, Sharpen, and your custom chips</span>
        </span>
        <div class="flex flex-wrap justify-end gap-1.5">
          {#each TONES as t (t.id)}
            <button
              class="rounded-pill px-3 py-1.5 text-[12.5px] font-semibold shadow-sm transition-transform duration-100 active:scale-95"
              class:bg-accent={settings.tone === t.id}
              class:text-white={settings.tone === t.id}
              class:bg-face={settings.tone !== t.id}
              aria-pressed={settings.tone === t.id}
              onclick={() => { settings.tone = t.id; persist(); }}
            >{t.label}</button>
          {/each}
        </div>
      </div>

      <!-- Action list (all actions, incl. hidden) -->
      {#each allActions as action, i (action.id)}
        <div class="flex items-center justify-between gap-3.5 border-b border-line py-3">
          <span class="min-w-0">
            <span class="font-semibold">
              {action.label}
              {#if action.custom}
                <span class="ml-1.5 rounded border border-line bg-face px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-grey">
                  custom
                </span>
              {/if}
            </span>
            <span class="mt-0.5 block truncate text-[12.5px] text-grey">{action.hint}</span>
          </span>
          <div class="flex shrink-0 items-center gap-1.5">
            <!-- Reorder -->
            <button
              class="grid h-[26px] w-[26px] place-items-center rounded-lg bg-face text-[13px] text-grey shadow-sm hover:text-ink disabled:opacity-30 disabled:hover:text-grey"
              aria-label={"Move " + action.label + " up"}
              disabled={i === 0}
              onclick={() => moveAction(i, -1)}
            >↑</button>
            <button
              class="grid h-[26px] w-[26px] place-items-center rounded-lg bg-face text-[13px] text-grey shadow-sm hover:text-ink disabled:opacity-30 disabled:hover:text-grey"
              aria-label={"Move " + action.label + " down"}
              disabled={i === allActions.length - 1}
              onclick={() => moveAction(i, 1)}
            >↓</button>
            {#if action.custom}
              <button
                class="pillbtn !px-3 !py-1.5 !text-[12px]"
                onclick={() => startEdit(action)}
              >Edit</button>
              <button
                class="grid h-[26px] w-[26px] place-items-center rounded-full bg-panel text-[11px] text-grey hover:text-ink"
                aria-label={"Delete " + action.label}
                onclick={() => deleteCustom(action)}
              >✕</button>
            {/if}
            <!-- On/off (hidden) toggle. Knob position is flex-driven, not transform. -->
            <button
              role="switch" aria-checked={!settings.hiddenActions.includes(action.id)}
              aria-label={"Show " + action.label}
              class="flex h-[23px] w-10 shrink-0 items-center rounded-full px-[2.5px] transition-colors"
              class:justify-end={!settings.hiddenActions.includes(action.id)}
              class:bg-accent={!settings.hiddenActions.includes(action.id)}
              class:bg-line={settings.hiddenActions.includes(action.id)}
              onclick={() => toggleAction(action.id)}
            >
              <span class="h-[18px] w-[18px] rounded-full bg-white shadow"></span>
            </button>
          </div>
        </div>
      {/each}

      <!-- Add / edit form -->
      <div class="mt-3 flex flex-col gap-2.5">
        <span class="text-[12.5px] font-semibold text-grey">
          {editingId ? "Edit chip" : "Add a chip"}
        </span>
        <input
          class="w-full rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          placeholder="Button name" maxlength={CUSTOM_ACTION_LIMITS.maxLabel}
          bind:value={actionLabel}
        />
        <textarea
          class="min-h-[68px] w-full resize-y rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          placeholder="What should it do? e.g. Translate this into Spanish."
          maxlength={CUSTOM_ACTION_LIMITS.maxPrompt}
          bind:value={actionPrompt}
        ></textarea>
        {#if actionError}
          <p class="text-[12.5px] font-semibold text-accent">{actionError}</p>
        {/if}
        {#if atCustomLimit && !editingId}
          <p class="rounded-lg bg-panel px-3 py-2 text-[12.5px] text-grey">
            You've reached {CUSTOM_ACTION_LIMITS.maxCount} custom chips — edit or
            remove one to add another.
          </p>
        {/if}
        <div class="flex items-center gap-2.5">
          <button
            class="pillbtn pillbtn-dark disabled:cursor-default disabled:opacity-40"
            disabled={atCustomLimit && !editingId}
            onclick={submitAction}
          >{editingId ? "Save" : "Add action"}</button>
          {#if editingId}
            <button class="pillbtn" onclick={cancelEdit}>Cancel</button>
          {/if}
        </div>
      </div>
    </section>

    <!-- Saved prompts -->
    <section class="rounded-[22px] bg-screen px-5 py-4 shadow-sm">
      <h2 class="mb-1 text-[13px] font-bold uppercase tracking-wider text-grey">Saved prompts</h2>
      <p class="text-[12.5px] text-grey">
        Reusable snippets you drop into a transcript with one tap. Add the
        prompts you dictate into AI tools again and again.
      </p>

      <!-- Prompt list -->
      {#each settings.savedPrompts as prompt (prompt.id)}
        <div class="flex items-center justify-between gap-3.5 border-b border-line py-3">
          <span class="min-w-0">
            <span class="font-semibold">{prompt.name}</span>
            <span class="mt-0.5 block truncate text-[12.5px] text-grey">{prompt.text}</span>
          </span>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              class="pillbtn !px-3 !py-1.5 !text-[12px]"
              onclick={() => startPromptEdit(prompt)}
            >Edit</button>
            <button
              class="grid h-[26px] w-[26px] place-items-center rounded-full bg-panel text-[11px] text-grey hover:text-ink"
              aria-label={"Delete " + prompt.name}
              onclick={() => deletePrompt(prompt)}
            >✕</button>
          </div>
        </div>
      {/each}

      <!-- Add / edit form -->
      <div class="mt-3 flex flex-col gap-2.5">
        <span class="text-[12.5px] font-semibold text-grey">
          {editingPromptId ? "Edit prompt" : "Add a prompt"}
        </span>
        <input
          class="w-full rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          placeholder="Prompt name" maxlength={SAVED_PROMPT_LIMITS.maxName}
          bind:value={promptName}
        />
        <textarea
          class="min-h-[68px] w-full resize-y rounded-xl border border-line bg-face px-3 py-1.5 text-[13.5px]"
          placeholder="The snippet text you want to reuse."
          maxlength={SAVED_PROMPT_LIMITS.maxText}
          bind:value={promptText}
        ></textarea>
        <span class="self-end text-[11px] text-grey">
          {promptText.length}/{SAVED_PROMPT_LIMITS.maxText}
        </span>
        {#if promptError}
          <p class="text-[12.5px] font-semibold text-accent">{promptError}</p>
        {/if}
        {#if atPromptLimit && !editingPromptId}
          <p class="rounded-lg bg-panel px-3 py-2 text-[12.5px] text-grey">
            You've saved {SAVED_PROMPT_LIMITS.maxCount} prompts — edit or remove
            one to add another.
          </p>
        {/if}
        <div class="flex items-center gap-2.5">
          <button
            class="pillbtn pillbtn-dark disabled:cursor-default disabled:opacity-40"
            disabled={atPromptLimit && !editingPromptId}
            onclick={submitPrompt}
          >{editingPromptId ? "Save" : "Add prompt"}</button>
          {#if editingPromptId}
            <button class="pillbtn" onclick={cancelPromptEdit}>Cancel</button>
          {/if}
        </div>
      </div>
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
