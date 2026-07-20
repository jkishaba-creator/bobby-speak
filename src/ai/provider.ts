// The AI layer's single contract, straight from ARCHITECTURE.md:
//
//     Audio stream in → transcript events out.
//
// The rest of the app never knows which provider produced the text, what
// runtime it used, or whether it ran locally or in the cloud.

import type { Stream } from "../shared/stream";
import type { AudioFrame, Settings, TranscriptEvent } from "../shared/types";

export interface AsrContext {
  /** 16 kHz frames from the audio layer. Providers may ignore this (Chrome
   *  Speech captures its own audio) — that quirk stays inside the provider. */
  audio: Stream<AudioFrame>;
  /** Raw mic stream, for providers that need a MediaStream. */
  mediaStream: MediaStream;
  settings: Settings;
  emit(event: TranscriptEvent): void;
  error(message: string): void;
}

export interface AsrProvider {
  readonly id: string;
  readonly label: string;
  /** true = partials while speaking; false = one final after stop(). */
  readonly streaming: boolean;
  start(ctx: AsrContext): void | Promise<void>;
  /** Flush and emit any remaining finals, then resolve. */
  stop(): void | Promise<void>;
}

export type AsrProviderFactory = () => AsrProvider;

const registry = new Map<string, AsrProviderFactory>();

export function registerProvider(id: string, factory: AsrProviderFactory): void {
  registry.set(id, factory);
}

export function createProvider(id: string): AsrProvider {
  const factory = registry.get(id) ?? registry.get("chrome");
  if (!factory) throw new Error("no ASR providers registered");
  return factory();
}
