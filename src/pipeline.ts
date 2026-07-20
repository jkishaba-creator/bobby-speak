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
import { grammarStage } from "./processing/stages/grammar";
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

export async function startDictation(
  settings: Settings,
): Promise<DictationSession> {
  const events = new Emitter<DictationEvent>();
  const ctx = { settings };

  let capture: AudioCapture;
  try {
    capture = await startCapture();
  } catch (err) {
    // Report through the stream so callers have one error path.
    queueMicrotask(() =>
      events.emit(
        err instanceof MicDeniedError
          ? { type: "mic-denied" }
          : { type: "error", message: String(err) },
      ),
    );
    return { events, stop: async () => {} };
  }

  capture.levels.subscribe((levels) => events.emit({ type: "level", levels }));

  // Raw committed text accumulates; every emission re-runs the sync pipeline
  // over the whole committed text so cross-phrase rules (capitalization after
  // a previous final's period) stay correct.
  let committedRaw = "";
  let finished = false;

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

  const provider: AsrProvider = createProvider(settings.engine);

  const finish = async () => {
    if (finished) return;
    finished = true;
    capture.stop();
    let transcript = runSyncPipeline(
      SYNC_STAGES,
      { kind: "final", text: committedRaw },
      ctx,
    ).text;
    transcript = await runAsyncPipeline(ASYNC_STAGES, transcript, ctx);
    events.emit({ type: "done", transcript });
  };

  provider.start({
    audio: capture.frames,
    mediaStream: capture.mediaStream,
    settings,
    emit(event: TextEvent) {
      if (event.kind === "final") {
        committedRaw += event.text;
        emitText("");
      } else {
        emitText(event.text);
      }
    },
    error(message: string) {
      capture.stop();
      if (message === "mic-denied") events.emit({ type: "mic-denied" });
      else events.emit({ type: "error", message });
    },
  });

  return {
    events,
    async stop() {
      await provider.stop(); // batch providers emit their final during stop()
      await finish();
    },
  };
}
