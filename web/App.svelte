<script lang="ts">
  // Bobby Speak on mobile. The same pipeline the extension runs — audio →
  // ASR provider → processing stages → text — wrapped in a phone-shaped
  // shell instead of a browser extension.
  //
  // The mobile flow is the pop-out flow: dictate here, the cleaned text is
  // already on your clipboard, paste into whatever app you were in.

  import { tick } from "svelte";
  import { startDictation, type DictationSession } from "../src/pipeline";
  import { getSettings, saveSettings } from "../src/shared/settings";
  import {
    DEFAULT_SETTINGS,
    type CustomAction,
    type EngineId,
    type SavedPrompt,
    type Settings,
    type ToneId,
  } from "../src/shared/types";
  import {
    CUSTOM_ACTION_LIMITS,
    TEXT_ACTIONS,
    TONES,
    chipsUsable,
    resolveActions,
    runTextAction,
    sanitizeCustomAction,
    type TextAction,
  } from "../src/ai/textActions";
  import {
    SAVED_PROMPT_LIMITS,
    sanitizeSavedPrompt,
    suggestPromptName,
  } from "../src/shared/prompts";

  // "Ask" is a fixed built-in; its inline question input needs a stable handle
  // even if the chip is reordered or hidden from the row.
  const ASK = TEXT_ACTIONS.find((a) => a.needsQuestion)!;

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
        case "done": {
          finish();
          if (event.transcript) {
            transcript = event.transcript;
            void copyOut(event.transcript);
            status = "Copied — paste anywhere";
          } else {
            status = "Didn't catch that — tap to try again";
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
          finish();
          status = "Tap to speak";
          errorMsg =
            "Microphone blocked. Allow mic access for this site in your browser settings, then reload.";
          break;
        case "error":
          pendingAction = null;
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
    previous = null;
    askOpen = false;
    question = "";
    pendingAction = null;
  }

  // ---- AI text actions (clean / summarize / sharpen / ask) ----
  // Every action replaces the transcript and stashes what it replaced, so a
  // single Undo always gets you back — important when the model surprises you.
  let running: string | null = $state(null);
  let previous: string | null = $state(null);
  let askOpen = $state(false);
  let question = $state("");
  // A chip tapped while recording: finish the take first, apply after "done".
  let pendingAction: TextAction | null = null;

  const actionsReady = $derived(
    !!transcript.trim() && !!settings.cfAccountId && !!settings.cfApiToken,
  );

  // The shared gate (src/ai/textActions.ts): keys-only while recording, keys
  // plus text otherwise — one rule for the pop-out and the web app alike.
  const chipUsable = $derived(chipsUsable(listening, transcript, settings));

  async function applyAction(action: TextAction) {
    if (running) return;
    if (listening) {
      // Speak, then tap a chip: the tap finishes the recording, and the
      // action runs on the final transcript once the engine flushes it.
      pendingAction = action;
      status = "Finishing the recording…";
      void stop();
      return;
    }
    if (action.needsQuestion && !askOpen) {
      askOpen = true;
      return;
    }
    if (!actionsReady) {
      errorMsg = !transcript.trim()
        ? "Dictate something first."
        : "Add your Cloudflare keys in Settings to use AI actions.";
      return;
    }

    errorMsg = "";
    running = action.id;
    const before = transcript;
    const result = await runTextAction(
      action,
      transcript,
      $state.snapshot(settings),
      question,
    );
    running = null;

    // A new recording started while the model was working; its transcript
    // owns the screen now — don't clobber it with a stale result.
    if (listening) return;

    if (!result.ok) {
      errorMsg = result.error;
      return;
    }
    previous = before;
    transcript = result.text;
    askOpen = false;
    question = "";
    status = action.id === "ask" ? "Answer — copied" : "Updated — copied";
    void copyOut(result.text);
  }

  function undo() {
    if (previous === null) return;
    transcript = previous;
    previous = null;
    status = "Reverted";
    void copyOut(transcript);
  }

  // ---- Action customization (chips row + Actions settings section) ----
  // The row the user sees, and the full catalog (hidden chips included) that
  // the settings editor lists so anything can be un-hidden or reordered.
  const chips = $derived(resolveActions(settings));
  const allActions = $derived(resolveActions({ ...settings, hiddenActions: [] }));

  function setTone(tone: ToneId) {
    settings.tone = tone;
    persist();
  }

  function isHidden(id: string): boolean {
    return (settings.hiddenActions ?? []).includes(id);
  }

  function toggleHidden(id: string) {
    const hidden = new Set(settings.hiddenActions ?? []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    settings.hiddenActions = [...hidden];
    persist();
  }

  function moveAction(id: string, dir: -1 | 1) {
    const ids = allActions.map((a) => a.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    settings.actionOrder = ids;
    persist();
  }

  function customFor(a: TextAction): CustomAction | undefined {
    return (settings.customActions ?? []).find((c) => "custom-" + c.id === a.id);
  }

  // Add / edit / delete custom chips, validated through the core helper.
  let formOpen = $state(false);
  let editingId: string | null = $state(null);
  let draftLabel = $state("");
  let draftPrompt = $state("");
  let actionError = $state("");

  function startNew() {
    editingId = null;
    draftLabel = "";
    draftPrompt = "";
    actionError = "";
    formOpen = true;
  }

  function startEdit(c: CustomAction) {
    editingId = c.id;
    draftLabel = c.label;
    draftPrompt = c.prompt;
    actionError = "";
    formOpen = true;
  }

  function cancelForm() {
    formOpen = false;
    editingId = null;
    draftLabel = "";
    draftPrompt = "";
    actionError = "";
  }

  function saveCustom() {
    const res = sanitizeCustomAction(
      { id: editingId ?? undefined, label: draftLabel, prompt: draftPrompt },
      settings.customActions ?? [],
    );
    if (!res.ok) {
      actionError = res.error;
      return;
    }
    const list = (settings.customActions ?? []).slice();
    const idx = list.findIndex((c) => c.id === res.action.id);
    if (idx >= 0) list[idx] = res.action;
    else list.push(res.action);
    settings.customActions = list;
    persist();
    cancelForm();
  }

  function deleteCustom(c: CustomAction) {
    const catalogId = "custom-" + c.id;
    settings.customActions = (settings.customActions ?? []).filter(
      (x) => x.id !== c.id,
    );
    settings.hiddenActions = (settings.hiddenActions ?? []).filter(
      (id) => id !== catalogId,
    );
    settings.actionOrder = (settings.actionOrder ?? []).filter(
      (id) => id !== catalogId,
    );
    if (editingId === c.id) cancelForm();
    persist();
  }

  // The "＋" chip and the header gear both open the sheet; the chip drops the
  // user at the Actions section.
  let actionsSectionEl: HTMLElement | undefined = $state();

  async function openActionsSettings() {
    showSettings = true;
    await tick();
    actionsSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Saved prompts (quick-use strip + Save flow + settings editor) ----
  // Reusable snippets validated through the shared core helper. Tapping a chip
  // stashes the current transcript in the same undo slot the AI actions use,
  // so one Undo always brings back what was there.
  function usePrompt(prompt: SavedPrompt) {
    previous = transcript;
    transcript = prompt.text;
    void copyOut(prompt.text);
    status = "Loaded — copied";
  }

  // Save-in-the-moment: an inline name row prefilled from the transcript.
  let saveOpen = $state(false);
  let saveName = $state("");
  let saveError = $state("");

  function openSave() {
    saveName = suggestPromptName(transcript);
    saveError = "";
    saveOpen = true;
  }

  function cancelSave() {
    saveOpen = false;
    saveName = "";
    saveError = "";
  }

  function confirmSave() {
    const res = sanitizeSavedPrompt(
      { name: saveName, text: transcript },
      settings.savedPrompts ?? [],
    );
    if (!res.ok) {
      saveError = res.error;
      return;
    }
    settings.savedPrompts = [...(settings.savedPrompts ?? []), res.prompt];
    persist();
    cancelSave();
    status = "Saved for next time";
  }

  // Add / edit / delete in the settings sheet, same core validation.
  let promptFormOpen = $state(false);
  let promptEditingId: string | null = $state(null);
  let promptDraftName = $state("");
  let promptDraftText = $state("");
  let promptError = $state("");

  function startNewPrompt() {
    promptEditingId = null;
    promptDraftName = "";
    promptDraftText = "";
    promptError = "";
    promptFormOpen = true;
  }

  function startEditPrompt(p: SavedPrompt) {
    promptEditingId = p.id;
    promptDraftName = p.name;
    promptDraftText = p.text;
    promptError = "";
    promptFormOpen = true;
  }

  function cancelPromptForm() {
    promptFormOpen = false;
    promptEditingId = null;
    promptDraftName = "";
    promptDraftText = "";
    promptError = "";
  }

  function savePrompt() {
    const res = sanitizeSavedPrompt(
      { id: promptEditingId ?? undefined, name: promptDraftName, text: promptDraftText },
      settings.savedPrompts ?? [],
    );
    if (!res.ok) {
      promptError = res.error;
      return;
    }
    const list = (settings.savedPrompts ?? []).slice();
    const idx = list.findIndex((p) => p.id === res.prompt.id);
    if (idx >= 0) list[idx] = res.prompt;
    else list.push(res.prompt);
    settings.savedPrompts = list;
    persist();
    cancelPromptForm();
  }

  function deletePrompt(p: SavedPrompt) {
    settings.savedPrompts = (settings.savedPrompts ?? []).filter(
      (x) => x.id !== p.id,
    );
    if (promptEditingId === p.id) cancelPromptForm();
    persist();
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
      <svg
        class="tick-ring absolute inset-0 h-full w-full"
        class:spin={listening}
        viewBox="0 0 240 240"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="120" cy="120" r="116"
          stroke={listening ? "#E8620A" : "#A6A9B5"}
          stroke-width="3" stroke-linecap="round"
          stroke-dasharray="0.1 15.6" opacity={listening ? "0.9" : "0.75"}
        />
      </svg>
      {#if listening}
        <span class="rec-dot absolute left-1/2 top-1 z-[3] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-accent"></span>
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

  <!-- saved-prompts quick strip: one horizontally scrollable row of chips -->
  {#if settings.savedPrompts?.length}
    <div class="shrink-0">
      <span class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-grey">Saved</span>
      <div class="saved-strip flex flex-nowrap gap-2 overflow-x-auto">
        {#each settings.savedPrompts as prompt (prompt.id)}
          <button
            class="shrink-0 rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-grey transition-transform active:scale-95"
            disabled={listening || !!running}
            style={listening || !!running ? "opacity:.45" : ""}
            title={prompt.text}
            onclick={() => usePrompt(prompt)}
          >
            {prompt.name}
          </button>
        {/each}
      </div>
    </div>
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

  <!-- AI actions -->
  <div class="shrink-0">
    <!-- tone pills: the voice applied to Clean, Sharpen and custom chips -->
    <div class="mb-2 flex flex-wrap items-center gap-1.5">
      <span class="mr-0.5 text-[11px] font-bold uppercase tracking-wider text-grey">Tone</span>
      {#each TONES as t (t.id)}
        <button
          class="rounded-full px-3 py-1 text-[12px] font-semibold shadow-sm transition-transform active:scale-95"
          class:bg-ink={settings.tone === t.id}
          class:text-screen={settings.tone === t.id}
          class:bg-face={settings.tone !== t.id}
          class:text-grey={settings.tone !== t.id}
          aria-pressed={settings.tone === t.id}
          onclick={() => setTone(t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>

    {#if askOpen}
      <div class="mb-2 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-xl border border-line bg-face px-3 py-2.5 text-[16px]"
          placeholder="Ask about this text…"
          bind:value={question}
          onkeydown={(e) => e.key === "Enter" && applyAction(ASK)}
        />
        <button
          class="pillbtn pillbtn-dark shrink-0"
          onclick={() => applyAction(ASK)}
          disabled={!!running}
        >
          {running === "ask" ? "…" : "Go"}
        </button>
        <button class="pillbtn shrink-0" onclick={() => { askOpen = false; question = ""; }}>
          ✕
        </button>
      </div>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#each chips as action (action.id)}
        <button
          class="rounded-xl bg-face px-3.5 py-2 text-[13.5px] font-semibold shadow-sm transition-transform active:scale-95"
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
          class="rounded-xl bg-panel px-3.5 py-2 text-[13.5px] font-semibold text-grey transition-transform active:scale-95"
          onclick={undo}
        >
          ↩ Undo
        </button>
      {/if}

      <button
        class="rounded-xl bg-panel px-3.5 py-2 text-[13.5px] font-semibold text-grey shadow-sm transition-transform active:scale-95"
        title="Customize actions"
        aria-label="Customize actions"
        onclick={openActionsSettings}
      >
        ＋
      </button>
    </div>
  </div>

  <!-- save-in-the-moment: inline name row above the bottom controls -->
  {#if saveOpen}
    <div class="shrink-0">
      <div class="flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-xl border border-line bg-face px-3 py-2.5 text-[16px]"
          placeholder="Name this prompt…"
          maxlength={SAVED_PROMPT_LIMITS.maxName}
          bind:value={saveName}
          onkeydown={(e) => e.key === "Enter" && confirmSave()}
        />
        <button class="pillbtn pillbtn-dark shrink-0" onclick={confirmSave}>Save</button>
        <button class="pillbtn shrink-0" onclick={cancelSave}>✕</button>
      </div>
      {#if saveError}
        <p class="mt-1.5 text-[12.5px] font-semibold text-accent">{saveError}</p>
      {/if}
    </div>
  {/if}

  <!-- actions -->
  <div class="flex shrink-0 items-center gap-2.5">
    <button class="pillbtn shrink-0" onclick={clearAll}>Clear</button>
    <button
      class="pillbtn shrink-0"
      onclick={openSave}
      disabled={!transcript.trim()}
      style={!transcript.trim() ? "opacity:.45" : ""}
    >
      Save
    </button>
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

      <!-- Actions: tone, hide/reorder, and custom one-tap chips -->
      <section
        bind:this={actionsSectionEl}
        class="mb-4 scroll-mt-4 rounded-[20px] bg-screen px-4 py-3"
      >
        <h3 class="mb-1 text-[12px] font-bold uppercase tracking-wider text-grey">Actions</h3>
        <p class="mb-2 text-[12.5px] text-grey">
          Tap a chip after dictating to reshape the text. Hide, reorder, or add
          your own one-tap chips.
        </p>

        <!-- tone mirror -->
        <div class="border-b border-line pb-3">
          <span class="text-[13px] font-semibold">Tone</span>
          <span class="mt-0.5 mb-2 block text-[12.5px] text-grey">
            Applied to Clean, Sharpen, and your custom chips.
          </span>
          <div class="flex flex-wrap gap-1.5">
            {#each TONES as t (t.id)}
              <button
                class="rounded-full px-3 py-1 text-[12px] font-semibold shadow-sm transition-transform active:scale-95"
                class:bg-ink={settings.tone === t.id}
                class:text-screen={settings.tone === t.id}
                class:bg-face={settings.tone !== t.id}
                class:text-grey={settings.tone !== t.id}
                aria-pressed={settings.tone === t.id}
                onclick={() => setTone(t.id)}
              >
                {t.label}
              </button>
            {/each}
          </div>
        </div>

        <!-- hide / reorder list -->
        <div class="py-1">
          {#each allActions as action, i (action.id)}
            {@const custom = customFor(action)}
            <div class="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold" class:text-lite={isHidden(action.id)}>
                  {action.label}
                  {#if custom}<span class="text-[11px] font-normal text-lite"> · custom</span>{/if}
                </span>
                <span class="mt-0.5 block truncate text-[12px] text-grey">{action.hint}</span>
              </span>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  class="grid h-7 w-7 place-items-center rounded-lg bg-face text-[13px] text-grey shadow-sm active:scale-95 disabled:opacity-30"
                  aria-label={"Move " + action.label + " up"}
                  disabled={i === 0}
                  onclick={() => moveAction(action.id, -1)}
                >↑</button>
                <button
                  class="grid h-7 w-7 place-items-center rounded-lg bg-face text-[13px] text-grey shadow-sm active:scale-95 disabled:opacity-30"
                  aria-label={"Move " + action.label + " down"}
                  disabled={i === allActions.length - 1}
                  onclick={() => moveAction(action.id, 1)}
                >↓</button>
                <button
                  class="grid h-7 min-w-[3.4rem] place-items-center rounded-lg bg-face px-2 text-[11.5px] font-semibold shadow-sm active:scale-95"
                  class:text-accent={isHidden(action.id)}
                  class:text-grey={!isHidden(action.id)}
                  aria-pressed={!isHidden(action.id)}
                  onclick={() => toggleHidden(action.id)}
                >{isHidden(action.id) ? "Show" : "Hide"}</button>
                {#if custom}
                  <button
                    class="grid h-7 w-7 place-items-center rounded-lg bg-face text-[12px] text-grey shadow-sm active:scale-95"
                    aria-label={"Edit " + action.label}
                    onclick={() => startEdit(custom)}
                  >✎</button>
                  <button
                    class="grid h-7 w-7 place-items-center rounded-lg bg-panel text-[12px] text-grey shadow-sm active:scale-95"
                    aria-label={"Delete " + action.label}
                    onclick={() => deleteCustom(custom)}
                  >✕</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- add / edit custom chip -->
        {#if formOpen}
          <div class="mt-2 rounded-[16px] bg-face p-3 shadow-sm">
            <label class="block">
              <span class="text-[12.5px] font-semibold">Label</span>
              <input
                class="mt-1 w-full rounded-xl border border-line bg-screen px-3 py-2 text-[16px]"
                placeholder="e.g. Emoji-fy"
                maxlength={CUSTOM_ACTION_LIMITS.maxLabel}
                bind:value={draftLabel}
              />
            </label>
            <label class="mt-2 block">
              <span class="flex items-center justify-between text-[12.5px] font-semibold">
                <span>Instruction</span>
                <span class="font-normal text-lite">{draftPrompt.length}/{CUSTOM_ACTION_LIMITS.maxPrompt}</span>
              </span>
              <textarea
                class="mt-1 h-24 w-full resize-none rounded-xl border border-line bg-screen px-3 py-2 text-[16px]"
                placeholder="Describe what to do with the text, in plain English."
                maxlength={CUSTOM_ACTION_LIMITS.maxPrompt}
                bind:value={draftPrompt}
              ></textarea>
            </label>
            {#if actionError}
              <p class="mt-1.5 text-[12.5px] font-semibold text-accent">{actionError}</p>
            {/if}
            <div class="mt-2.5 flex gap-2">
              <button class="pillbtn pillbtn-dark flex-1" onclick={saveCustom}>
                {editingId ? "Save" : "Add chip"}
              </button>
              <button class="pillbtn" onclick={cancelForm}>Cancel</button>
            </div>
          </div>
        {:else}
          <button
            class="mt-2 w-full rounded-xl border border-dashed border-line bg-face py-2.5 text-[13px] font-semibold text-grey active:scale-[0.99]"
            disabled={(settings.customActions ?? []).length >= CUSTOM_ACTION_LIMITS.maxCount}
            style={(settings.customActions ?? []).length >= CUSTOM_ACTION_LIMITS.maxCount ? "opacity:.45" : ""}
            onclick={startNew}
          >
            ＋ Add custom chip
            <span class="font-normal text-lite">
              ({(settings.customActions ?? []).length}/{CUSTOM_ACTION_LIMITS.maxCount})
            </span>
          </button>
        {/if}
      </section>

      <!-- Saved prompts: reusable snippets loaded from the quick strip -->
      <section class="mb-4 rounded-[20px] bg-screen px-4 py-3">
        <h3 class="mb-1 text-[12px] font-bold uppercase tracking-wider text-grey">Saved prompts</h3>
        <p class="mb-2 text-[12.5px] text-grey">
          Snippets you reuse — tap one from the Saved strip to load and copy it.
        </p>

        <!-- list -->
        <div class="py-1">
          {#each settings.savedPrompts ?? [] as prompt (prompt.id)}
            <div class="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{prompt.name}</span>
                <span class="mt-0.5 block truncate text-[12px] text-grey">{prompt.text}</span>
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  class="grid h-7 w-7 place-items-center rounded-lg bg-face text-[12px] text-grey shadow-sm active:scale-95"
                  aria-label={"Edit " + prompt.name}
                  onclick={() => startEditPrompt(prompt)}
                >✎</button>
                <button
                  class="grid h-7 w-7 place-items-center rounded-lg bg-panel text-[12px] text-grey shadow-sm active:scale-95"
                  aria-label={"Delete " + prompt.name}
                  onclick={() => deletePrompt(prompt)}
                >✕</button>
              </div>
            </div>
          {/each}
        </div>

        <!-- add / edit prompt -->
        {#if promptFormOpen}
          <div class="mt-2 rounded-[16px] bg-face p-3 shadow-sm">
            <label class="block">
              <span class="text-[12.5px] font-semibold">Name</span>
              <input
                class="mt-1 w-full rounded-xl border border-line bg-screen px-3 py-2 text-[16px]"
                placeholder="e.g. Standup update"
                maxlength={SAVED_PROMPT_LIMITS.maxName}
                bind:value={promptDraftName}
              />
            </label>
            <label class="mt-2 block">
              <span class="flex items-center justify-between text-[12.5px] font-semibold">
                <span>Text</span>
                <span class="font-normal text-lite">{promptDraftText.length}/{SAVED_PROMPT_LIMITS.maxText}</span>
              </span>
              <textarea
                class="mt-1 h-24 w-full resize-none rounded-xl border border-line bg-screen px-3 py-2 text-[16px]"
                placeholder="The snippet to reuse."
                maxlength={SAVED_PROMPT_LIMITS.maxText}
                bind:value={promptDraftText}
              ></textarea>
            </label>
            {#if promptError}
              <p class="mt-1.5 text-[12.5px] font-semibold text-accent">{promptError}</p>
            {/if}
            <div class="mt-2.5 flex gap-2">
              <button class="pillbtn pillbtn-dark flex-1" onclick={savePrompt}>
                {promptEditingId ? "Save" : "Add prompt"}
              </button>
              <button class="pillbtn" onclick={cancelPromptForm}>Cancel</button>
            </div>
          </div>
        {:else}
          <button
            class="mt-2 w-full rounded-xl border border-dashed border-line bg-face py-2.5 text-[13px] font-semibold text-grey active:scale-[0.99]"
            disabled={(settings.savedPrompts ?? []).length >= SAVED_PROMPT_LIMITS.maxCount}
            style={(settings.savedPrompts ?? []).length >= SAVED_PROMPT_LIMITS.maxCount ? "opacity:.45" : ""}
            onclick={startNewPrompt}
          >
            ＋ Add prompt
            <span class="font-normal text-lite">
              ({(settings.savedPrompts ?? []).length}/{SAVED_PROMPT_LIMITS.maxCount})
            </span>
          </button>
        {/if}
      </section>

      <p class="px-1 text-center text-[12px] leading-relaxed text-lite">
        Add to your home screen for an app-like experience. Nothing is stored on
        any server — transcripts and keys stay on this device.
      </p>
    </div>
  </div>
{/if}

<style>
  /* Saved strip: a single scrollable row, no visible scrollbar. */
  .saved-strip {
    scrollbar-width: none;
  }
  .saved-strip::-webkit-scrollbar {
    display: none;
  }
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
  /* Recording state: the same elements, just awake — the tick ring turns
     accent and crawls, the dot breathes, and the orb gets a soft warm halo. */
  .orb.fast {
    box-shadow:
      inset 0 0 0 1px rgba(20, 20, 30, 0.05),
      0 20px 44px -18px rgba(40, 42, 60, 0.45),
      0 0 0 2px rgba(232, 98, 10, 0.22),
      0 0 34px -8px rgba(232, 98, 10, 0.45);
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
