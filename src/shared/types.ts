// The vocabulary of the pipeline. Every layer speaks these types and nothing
// else — audio in, transcript events out, text events through processing.

/** 16 kHz mono PCM, the pipeline's only audio format. */
export interface AudioFrame {
  samples: Int16Array;
  /** Always 16000; carried so providers never have to assume. */
  sampleRate: 16000;
}

/** What an ASR provider emits. */
export interface TranscriptEvent {
  /** partial = may still change; final = committed, will not be revised. */
  kind: "partial" | "final";
  text: string;
}

/** What processing stages consume and produce. Same shape, refined text. */
export type TextEvent = TranscriptEvent;

/** Mic level buckets for the overlay waveform (0..1 × 9). */
export type LevelFrame = number[];

export type EngineId = "chrome" | "cf-whisper" | "cf-flux";

export interface Settings {
  engine: EngineId;
  language: string;
  removeFillers: boolean;
  spokenPunctuation: boolean;
  aiPolish: boolean;
  polishProvider: "chrome" | "cloudflare";
  cfTextModel: string;
  customWords: string[];
  historyLimit: number;
  cfAccountId: string;
  cfApiToken: string;
  cfGateway: string;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: "chrome",
  language: "en-US",
  removeFillers: true,
  spokenPunctuation: true,
  aiPolish: true,
  polishProvider: "chrome",
  cfTextModel: "@cf/meta/llama-3.1-8b-instruct",
  customWords: [],
  historyLimit: 25,
  cfAccountId: "",
  cfApiToken: "",
  cfGateway: "",
};

// ---------------------------------------------------------------------------
// Messages that cross extension-context boundaries. The typed pipeline lives
// inside the offscreen document; these are the only shapes that travel.

export type BackgroundMessage =
  | { target: "background"; type: "toggle" }
  | { target: "background"; type: "open-popout" }
  | { target: "background"; type: "copy-request"; text: string }
  | { target: "background"; type: "popout-state"; listening: boolean }
  | { target: "background"; type: "get-state" }
  | { target: "background"; type: "level"; levels: LevelFrame }
  | { target: "background"; type: "text"; event: TextEvent }
  | { target: "background"; type: "done"; transcript: string }
  | { target: "background"; type: "mic-denied" }
  | { target: "background"; type: "engine-error"; message: string };

export type OffscreenMessage =
  | { target: "offscreen"; type: "start"; settings: Settings; feedback?: boolean }
  | { target: "offscreen"; type: "stop" }
  | { target: "offscreen"; type: "copy"; text: string };

export type ContentMessage =
  | { type: "ping" }
  | { type: "overlay-show" }
  | { type: "overlay-processing" }
  | { type: "overlay-level"; levels: LevelFrame }
  | { type: "overlay-text"; committed: string; tentative: string }
  | { type: "overlay-error"; message: string }
  | { type: "overlay-hide" }
  | { type: "insert-text"; text: string };
