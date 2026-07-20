// Processing layer contract: text events in, improved text events out.
//
// Stages are pure functions over (text, context) so they compose, test in
// isolation, and can be reordered. Partials get the cheap synchronous chain
// on every keystroke-latency update; finals additionally get async stages
// (AI polish) that would be too slow to run while streaming.

import type { Settings, TextEvent } from "../shared/types";

export interface ProcessorContext {
  settings: Settings;
}

/** Synchronous stage: safe to run on every partial. */
export interface SyncStage {
  id: string;
  /** Whether this stage should run for the given event kind. */
  appliesTo(kind: TextEvent["kind"], ctx: ProcessorContext): boolean;
  run(text: string, ctx: ProcessorContext): string;
}

/** Async stage: finals only (latency budget doesn't fit the partial path). */
export interface AsyncStage {
  id: string;
  appliesTo(kind: "final", ctx: ProcessorContext): boolean;
  run(text: string, ctx: ProcessorContext): Promise<string | null>;
}

export function runSyncPipeline(
  stages: SyncStage[],
  event: TextEvent,
  ctx: ProcessorContext,
): TextEvent {
  let text = event.text;
  for (const stage of stages) {
    if (stage.appliesTo(event.kind, ctx)) text = stage.run(text, ctx);
  }
  return { kind: event.kind, text };
}

export async function runAsyncPipeline(
  stages: AsyncStage[],
  text: string,
  ctx: ProcessorContext,
): Promise<string> {
  let out = text;
  for (const stage of stages) {
    if (!stage.appliesTo("final", ctx)) continue;
    const result = await stage.run(out, ctx);
    if (result !== null) out = result;
  }
  return out;
}
