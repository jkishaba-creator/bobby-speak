// The AI polish stage sits between "user stopped talking" and "text appears".
// It must never be able to stall that path, however slow the model is.

import { describe, expect, it } from "vitest";
import {
  runAsyncPipeline,
  type AsyncStage,
  type ProcessorContext,
} from "../src/processing/processor";
import { DEFAULT_SETTINGS } from "../src/shared/types";

const ctx: ProcessorContext = { settings: { ...DEFAULT_SETTINGS } };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

describe("async stage budget", () => {
  it("falls back to the input when a stage exceeds its budget", async () => {
    const BUDGET = 100;
    const slowStage: AsyncStage = {
      id: "slow",
      appliesTo: () => true,
      run: (text) =>
        withTimeout(
          new Promise<string>((r) => setTimeout(() => r("polished " + text), 5000)),
          BUDGET,
        ),
    };

    const started = Date.now();
    const out = await runAsyncPipeline([slowStage], "hello world.", ctx);
    const elapsed = Date.now() - started;

    expect(out).toBe("hello world."); // unchanged, not stalled
    expect(elapsed).toBeLessThan(1000); // returned near the budget, not 5s
  });

  it("uses the stage result when it finishes inside the budget", async () => {
    const fastStage: AsyncStage = {
      id: "fast",
      appliesTo: () => true,
      run: (text) =>
        withTimeout(
          new Promise<string>((r) => setTimeout(() => r("Polished: " + text), 5)),
          200,
        ),
    };
    expect(await runAsyncPipeline([fastStage], "hello.", ctx)).toBe(
      "Polished: hello.",
    );
  });

  it("skips the stage entirely when the setting is off", async () => {
    const stage: AsyncStage = {
      id: "off",
      appliesTo: (_kind, c) => c.settings.aiPolish !== false,
      run: async () => "should not run",
    };
    const offCtx: ProcessorContext = {
      settings: { ...DEFAULT_SETTINGS, aiPolish: false },
    };
    expect(await runAsyncPipeline([stage], "untouched.", offCtx)).toBe(
      "untouched.",
    );
  });
});
