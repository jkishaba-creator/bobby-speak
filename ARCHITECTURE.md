# Bobby Speak V2 — Architecture

Based on the streaming-architecture spec contributed by
[@jR4dh3y](https://github.com/jR4dh3y) in
[issue #4](https://github.com/jkishaba-creator/bobby-speak/issues/4), adapted
for implementation. The product name, brand, and Air OS design language carry
over from v1 unchanged — **V2 changes the wiring, never the look.**

> **Vision:** the best open-source AI dictation extension for Chrome.
> Not built around models or providers — built around a **real-time streaming
> pipeline** that every component, local or cloud, plugs into.

## Design principles

**Streaming first.** Text appears while you speak.

```
Mic → Audio frames → ASR → Partial text → Processing → Overlay/Injection
```

**Provider agnostic.** The app never knows what produced the text. One
contract matters: *audio stream in, transcript events out* (`src/ai/provider.ts`).

**Pipeline driven.** Every stage consumes a stream and emits a stream. No
request/response anywhere inside the pipeline.

**Browser first.** Chrome MV3 is the platform. Native desktop is a non-goal.

## Layers

```
                    UI (Svelte + WXT)
                          │
                   Extension layer          entrypoints/
              routing · lifecycle · state   (no AI logic)
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   Audio layer         AI layer         Processing layer
   src/audio/          src/ai/          src/processing/
   mic · frames ·      providers:       staged, pure:
   levels · (VAD)      chrome-speech    fillers → spoken-punct
                       cf-whisper       → vocabulary → caps
                       deepgram-flux    → tidy → [AI polish]
                          │
                          ▼
                    Output layer
                    src/output/
                    inject · overlay · clipboard · history
```

- **Extension layer** (`entrypoints/`): background service worker (state
  machine + routing), content script (hosts output layer), offscreen document
  (hosts the pipeline — the only context allowed a microphone), popup.
- **Audio layer** (`src/audio/`): `getUserMedia` → 16 kHz Int16 frames +
  level meter. Knows nothing about transcription.
- **AI layer** (`src/ai/`): `AsrProvider` implementations behind a registry.
  Transport (HTTP, WebSocket, browser API) is a private detail of each
  provider file.
- **Processing layer** (`src/processing/`): pure stages composed into a
  pipeline. Sync stages run on every partial; async stages (on-device AI
  polish) run on finals only.
- **Output layer** (`src/output/`): DOM injection (standard inputs, React
  inputs, contenteditable), the Air OS overlay pill, clipboard fallback.

## The streaming model

Everything is events over a tiny typed `Stream<T>` primitive
(`src/shared/stream.ts`):

```
AudioFrame       { samples: Int16Array, sampleRate: 16000 }
TranscriptEvent  { kind: "partial" | "final", text }
DictationEvent   level | text{committed,tentative} | done | error
```

Runtime messages exist **only at context boundaries** (offscreen ↔ background
↔ content). Inside a context, everything is typed streams.

## Why this fixes the v1 "period" class of bug

v1 was one flat regex pass over finished text. V2 processing is staged and
kind-aware: partials get cheap synchronous stages with partial-safe behavior
(no terminal punctuation while you're mid-sentence), finals get the full
treatment. Stages are pure `(text, ctx) → text` functions — testable in
isolation, reorderable, and replaceable (the regex punctuation stage can be
swapped for a model-based one without touching anything else). The
literal-word guard from v1 PR #3 ships as part of the spoken-punctuation
stage.

## Latency budget

The path between "user stops" and "text appears" is sacred. Two rules keep it
short:

- **Sync stages only** on that path by default — they are pure string work,
  sub-millisecond.
- **Async stages must beat a deadline** (`POLISH_BUDGET_MS`, 1200 ms). The
  on-device model is warmed up when dictation *starts*, so first-use model
  loading overlaps with speaking; if polish still misses the budget it is
  abandoned and the rule-based text is used. Quality is a bonus, never a stall.

Timings are logged to the offscreen document's console
(`[bobby-speak] finish timings …`) — local only, nothing is transmitted.

## Adaptations from the original spec

Differences from the issue-#4 spec, and why:

1. **Name:** the spec says "WhisperFlow"; the product is **Bobby Speak** —
   brand and design language are keepers.
2. **Processing granularity:** the spec's per-stage streaming
   (`hel → Hello`) is approximated by re-running cheap sync stages over the
   whole committed text per event. True incremental processors are a
   follow-up once a stage becomes expensive enough to need it.
3. **VAD:** the audio layer has the seam (`frames` are already 16 kHz mono)
   but v2.0 ships without a VAD stage — Chrome Speech and Flux do their own
   endpointing, and Whisper batch doesn't need it. Silero-in-WASM slots in
   at `src/audio/` later.
4. **LiteRT.js / local Whisper:** registry slots exist (`registerProvider`),
   implementation is the next milestone, not this one.

## Stack

WXT · Svelte 5 · TypeScript · Tailwind 4 (tokens in `assets/tailwind.css`) ·
Vitest. Storage: `chrome.storage` (settings/history), IndexedDB planned for
audio blobs.

## Build & test

```bash
npm install
npm test          # vitest — processing + audio suites (v1 parity)
npm run check     # svelte-check, 0 errors expected
npm run build     # → .output/chrome-mv3, load unpacked from there
npm run dev       # live-reload dev mode
```
