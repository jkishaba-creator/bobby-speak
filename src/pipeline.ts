// The pipeline orchestrator: wires the four layers together, exactly the
// diagram in ARCHITECTURE.md.
//
//   Mic ─ frames ─▶ ASR provider ─ transcript events ─▶ processing ─▶ out
//
// Runs inside the offscreen document (the only extension context allowed to
// hold a microphone). The outside world sees only DictationEvents.

import { startCapture, MicDeniedError, type AudioCapture } from "./audio/capture";
import { createProvider, registerProvider, type AsrProvider } from "./ai/provider";
import { chromeSpeechProvider } from "./ai/providers/chrome-speech";
import { cloudflareWhisperProvider } from "./ai/providers/cloudflare-whisper";
import { deepgramFluxProvider } from "./ai/providers/deepgram-flux";
import {
  runAsyncPipeline,
  runSyncPipeline,
  type AsyncStage,
  type SyncStage,
} from "./processing/processor";
import { fillersStage } from "./processing/stages/fillers";
import { spokenPunctuationStage } from "./processing/stages/spoken-punctuation";
import { capitalizationStage, finalTidyStage } from "./processing/stages/capitalization";
import { vocabularyStage } from "./processing/stages/vocabulary";
import { grammarStage, warmUpGrammar } from "./processing/stages/grammar";
import { Emitter, type Stream } from "./shared/stream";
import type { LevelFrame, Settings, TextEvent } from "./shared/types";

registerProvider("chrome", chromeSpeechProvider);
registerProvider("cf-whisper", cloudflareWhisperProvider);
registerProvider("cf-flux", deepgramFluxProvider);

const SYNC_STAGES: SyncStage[] = [
  fillersStage,
  spokenPunctuationStage,
  vocabularyStage,
  capitalizationStage,
  finalTidyStage,
];

const ASYNC_STAGES: AsyncStage[] = [grammarStage];

export type DictationEvent =
  | { type: "level"; levels: LevelFrame }
  | { type: "text"; committed: string; tentative: string }
  | { type: "done"; transcript: string }
  | { type: "mic-denied" }
  | { type: "error"; message: string };

export interface DictationSession {
  events: Stream<DictationEvent>;
  stop(): Promise<void>;
}

// NOTE: synchronous by design. If this returned a promise, a caller doing
// `const s = await startDictation(); s.events.subscribe(...)` would miss any
// event emitted during setup — which is exactly how a denied microphone used
// to vanish silently. Returning synchronously guarantees the caller can
// subscribe before anything can fire.
export function startDictation(settings: Settings): DictationSession {
  const events = new Emitter<DictationEvent>();
  const ctx = { settings };

  // Load the on-device model while the user talks, so first-use model
  // loading never lands on the path between "stop" and text appearing.
  if (settings.aiPolish !== false) warmUpGrammar();

  let capture: AudioCapture | null = null;
  let committedRaw = "";
  let finished = false;
  let stopRequested = false;
  let partialCount = 0;
  let finalCount = 0;
  const provider: AsrProvider = createProvider(settings.engine);

  const emitText = (tentativeRaw: string) => {
    const committed = runSyncPipeline(
      SYNC_STAGES,
      { kind: "final", text: committedRaw },
      ctx,
    ).text;
    const tentative = tentativeRaw
      ? runSyncPipeline(SYNC_STAGES, { kind: "partial", text: tentativeRaw }, ctx).text
      : "";
    events.emit({ type: "text", committed, tentative });
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    capture?.stop();

    const t0 = performance.now();
    let transcript = runSyncPipeline(
      SYNC_STAGES,
      { kind: "final", text: committedRaw },
      ctx,
    ).text;
    const tSync = performance.now();

    const beforePolish = transcript;
    transcript = await runAsyncPipeline(ASYNC_STAGES, transcript, ctx);
    const tAsync = performance.now();

    // Local-only timing, visible in the offscreen document's console.
    console.info(
      "[bobby-speak] finish — %s partials, %s finals from engine; cleanup %sms, polish %sms (%s), total %sms; transcript %s chars",
      partialCount,
      finalCount,
      (tSync - t0).toFixed(0),
      (tAsync - tSync).toFixed(0),
      transcript === beforePolish ? "skipped/unchanged" : "applied",
      (tAsync - t0).toFixed(0),
      transcript.length,
    );

    events.emit({ type: "done", transcript });
  };

  // Setup runs after this function returns, so subscribers are already
  // attached by the time anything is emitted.
  const ready = (async () => {
    try {
      capture = await startCapture();
    } catch (err) {
      events.emit(
        err instanceof MicDeniedError
          ? { type: "mic-denied" }
          : { type: "error", message: String(err) },
      );
      return false;
    }

    if (stopRequested) {
      capture.stop();
      return false;
    }

    capture.levels.subscribe((levels) => events.emit({ type: "level", levels }));

    provider.start({
      audio: capture.frames,
      mediaStream: capture.mediaStream,
      settings,
      emit(event: TextEvent) {
        if (event.kind === "final") {
          finalCount++;
          committedRaw += event.text;
          emitText("");
        } else {
          partialCount++;
          emitText(event.text);
        }
      },
      error(message: string) {
        capture?.stop();
        if (message === "mic-denied") events.emit({ type: "mic-denied" });
        else events.emit({ type: "error", message });
      },
    });
    return true;
  })();

  return {
    events,
    async stop() {
      stopRequested = true;
      const started = await ready;
      if (!started) return; // never got a microphone; nothing to finalize

      const t0 = performance.now();
      await provider.stop(); // batch providers emit their final during stop()
      console.info(
        "[bobby-speak] provider '%s' stop took %sms",
        provider.id,
        (performance.now() - t0).toFixed(0),
      );
      await finish();
    },
  };
}

