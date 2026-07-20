// Audio layer: microphone → 16 kHz Int16 AudioFrame stream + level stream.
// Owns getUserMedia and the AudioContext; knows nothing about transcription.

import { Emitter, type Stream } from "../shared/stream";
import type { AudioFrame, LevelFrame } from "../shared/types";
import { downsampleTo16k } from "./resample";

export interface AudioCapture {
  frames: Stream<AudioFrame>;
  levels: Stream<LevelFrame>;
  /** The raw stream, for providers (Chrome Speech) that manage their own audio. */
  mediaStream: MediaStream;
  stop(): void;
}

export class MicDeniedError extends Error {
  constructor() {
    super("microphone access denied");
  }
}

export async function startCapture(): Promise<AudioCapture> {
  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new MicDeniedError();
  }

  const frames = new Emitter<AudioFrame>();
  const levels = new Emitter<LevelFrame>();
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Frame tap. ScriptProcessor is deprecated but is the one API that works
  // identically in offscreen documents and normal pages; an AudioWorklet
  // replacement is isolated behind this module's interface.
  const proc = audioCtx.createScriptProcessor(4096, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  proc.onaudioprocess = (e) => {
    const samples = downsampleTo16k(
      e.inputBuffer.getChannelData(0),
      audioCtx.sampleRate,
    );
    frames.emit({ samples, sampleRate: 16000 });
  };
  source.connect(proc);
  proc.connect(mute);
  mute.connect(audioCtx.destination);

  // Level meter for the overlay waveform, ~12 fps.
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId = 0;
  let last = 0;
  const loop = (t: number) => {
    rafId = requestAnimationFrame(loop);
    if (t - last < 80) return;
    last = t;
    analyser.getByteFrequencyData(data);
    const buckets: number[] = [];
    for (let b = 0; b < 9; b++) {
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += data[b * 8 + i] ?? 0;
      buckets.push(Math.min(1, sum / (8 * 170)));
    }
    levels.emit(buckets);
  };
  rafId = requestAnimationFrame(loop);

  return {
    frames,
    levels,
    mediaStream,
    stop() {
      cancelAnimationFrame(rafId);
      proc.onaudioprocess = null;
      try {
        source.disconnect();
        proc.disconnect();
        mute.disconnect();
      } catch {
        /* already torn down */
      }
      void audioCtx.close().catch(() => {});
      mediaStream.getTracks().forEach((t) => t.stop());
      frames.clear();
      levels.clear();
    },
  };
}
