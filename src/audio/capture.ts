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

// Tap raw Float32 samples from the mic. AudioWorklet is the modern path
// (ScriptProcessor is deprecated and its warning shows up in the
// chrome://extensions error panel); the fallback keeps stubbed test
// environments and any worklet-less context working.
async function attachFrameTap(
  audioCtx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onSamples: (chunk: Float32Array) => void,
): Promise<() => void> {
  try {
    if (audioCtx.audioWorklet) {
      await audioCtx.audioWorklet.addModule("/pcm-tap.worklet.js");
      const node = new AudioWorkletNode(audioCtx, "pcm-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
      source.connect(node);
      node.connect(audioCtx.destination); // outputs are silent; drives processing
      return () => {
        node.port.onmessage = null;
        try {
          source.disconnect(node);
          node.disconnect();
        } catch {
          /* already torn down */
        }
      };
    }
  } catch {
    /* fall through to ScriptProcessor */
  }
  const proc = audioCtx.createScriptProcessor(4096, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  proc.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0));
  source.connect(proc);
  proc.connect(mute);
  mute.connect(audioCtx.destination);
  return () => {
    proc.onaudioprocess = null;
    try {
      source.disconnect(proc);
      proc.disconnect();
      mute.disconnect();
    } catch {
      /* already torn down */
    }
  };
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

  const untap = await attachFrameTap(audioCtx, source, (chunk) => {
    frames.emit({
      samples: downsampleTo16k(chunk, audioCtx.sampleRate),
      sampleRate: 16000,
    });
  });

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
      untap();
      void audioCtx.close().catch(() => {});
      mediaStream.getTracks().forEach((t) => t.stop());
      frames.clear();
      levels.clear();
    },
  };
}
