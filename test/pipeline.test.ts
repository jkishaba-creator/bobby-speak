// End-to-end pipeline integration test.
//
// A real microphone can't run in CI, so the browser audio APIs are stubbed and
// a fake ASR provider stands in for the speech engine. Everything between them
// — provider contract, event ordering, committed/tentative splitting, the
// processing pipeline, the polish budget, teardown — is the real code.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerProvider } from "../src/ai/provider";
import type { AsrContext, AsrProvider } from "../src/ai/provider";
import { startDictation, type DictationEvent } from "../src/pipeline";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";

// ---------------------------------------------------------------- stubs

class FakeAudioNode {
  connect() {}
  disconnect() {}
}
class FakeAnalyser extends FakeAudioNode {
  fftSize = 256;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128;
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(0);
  }
}
class FakeAudioContext {
  sampleRate = 48000;
  destination = new FakeAudioNode();
  createMediaStreamSource() {
    return new FakeAudioNode();
  }
  createScriptProcessor() {
    return Object.assign(new FakeAudioNode(), {
      onaudioprocess: null as unknown,
    });
  }
  createGain() {
    return Object.assign(new FakeAudioNode(), { gain: { value: 1 } });
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  async close() {}
}

function installBrowserStubs() {
  const track = { stop: vi.fn() };
  const mediaStream = { getTracks: () => [track] };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(async () => mediaStream) },
    platform: "MacIntel",
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return { track };
}

/** Lets a test drive transcript events exactly when it wants to. */
function makeFakeProvider() {
  let ctx: AsrContext | null = null;
  let stopDelayMs = 0;
  const provider: AsrProvider = {
    id: "fake",
    label: "Fake",
    streaming: true,
    start(c) {
      ctx = c;
    },
    async stop() {
      if (stopDelayMs) await new Promise((r) => setTimeout(r, stopDelayMs));
    },
  };
  return {
    provider,
    partial: (text: string) => ctx!.emit({ kind: "partial", text }),
    final: (text: string) => ctx!.emit({ kind: "final", text }),
    fail: (message: string) => ctx!.error(message),
    setStopDelay: (ms: number) => (stopDelayMs = ms),
  };
}

/** Let startDictation's async setup (capture + provider.start) complete. */
const tick = () => new Promise((r) => setTimeout(r, 0));

let harness: ReturnType<typeof makeFakeProvider>;
registerProvider("fake", () => harness.provider);

function settings(overrides: Partial<Settings> = {}): Settings {
  // aiPolish off by default here: Gemini Nano doesn't exist in node, and the
  // budget path is covered by polish-budget.test.ts.
  return { ...DEFAULT_SETTINGS, engine: "fake" as never, aiPolish: false, ...overrides };
}

// ---------------------------------------------------------------- tests

describe("dictation pipeline", () => {
  beforeEach(() => {
    installBrowserStubs();
    harness = makeFakeProvider();
  });

  it("streams partials, then commits finals, then emits a cleaned transcript", async () => {
    const events: DictationEvent[] = [];
    const session = startDictation(settings());
    session.events.subscribe((e) => events.push(e));
    await tick();

    harness.partial("hello wor");
    harness.partial("hello world");
    harness.final("hello world ");
    harness.partial("how are y");
    harness.final("how are you question mark ");

    await session.stop();

    const texts = events.filter((e) => e.type === "text") as Extract<
      DictationEvent,
      { type: "text" }
    >[];

    // A partial must never get a terminal period bolted on mid-sentence.
    expect(texts[0].tentative).toBe("Hello wor");
    expect(texts[0].tentative.endsWith(".")).toBe(false);

    // Finals accumulate into committed text.
    const lastText = texts[texts.length - 1];
    expect(lastText.committed).toContain("Hello world");

    const done = events.find((e) => e.type === "done") as Extract<
      DictationEvent,
      { type: "done" }
    >;
    expect(done).toBeDefined();
    // Spoken punctuation applied, sentences capitalized, terminal mark added.
    expect(done.transcript).toBe("Hello world how are you?");
  });

  it("applies filler removal and custom words across the whole session", async () => {
    const events: DictationEvent[] = [];
    const session = startDictation(settings({ customWords: ["Kubernetes"] }));
    session.events.subscribe((e) => events.push(e));
    await tick();

    harness.final("um i deployed to kubernets ");
    harness.final("and it it worked ");
    await session.stop();

    const done = events.find((e) => e.type === "done") as Extract<
      DictationEvent,
      { type: "done" }
    >;
    expect(done.transcript).toBe("I deployed to Kubernetes and it worked.");
  });

  it("does not stall when the provider is slow to stop", async () => {
    harness.setStopDelay(120);
    const session = startDictation(settings());
    await tick();
    harness.final("quick note ");

    const started = Date.now();
    await session.stop();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(100); // it did wait for the provider
    expect(elapsed).toBeLessThan(2000); // but nothing else piled on
  });

  it("reports engine errors instead of hanging", async () => {
    const events: DictationEvent[] = [];
    const session = startDictation(settings());
    session.events.subscribe((e) => events.push(e));
    await tick();

    harness.fail("Flux connection rejected");

    const err = events.find((e) => e.type === "error") as Extract<
      DictationEvent,
      { type: "error" }
    >;
    expect(err.message).toBe("Flux connection rejected");
  });

  it("surfaces a denied microphone as mic-denied", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new Error("NotAllowedError");
        }),
      },
      platform: "MacIntel",
    });

    const events: DictationEvent[] = [];
    const session = startDictation(settings());
    session.events.subscribe((e) => events.push(e));
    await tick();

    expect(events.some((e) => e.type === "mic-denied")).toBe(true);
    await session.stop(); // must not throw
  });

  it("releases the microphone when the session ends", async () => {
    const { track } = installBrowserStubs();
    const session = startDictation(settings());
    await tick();
    harness.final("done ");
    await session.stop();
    expect(track.stop).toHaveBeenCalled();
  });

  it("emits done exactly once even if stop is called twice", async () => {
    const events: DictationEvent[] = [];
    const session = startDictation(settings());
    session.events.subscribe((e) => events.push(e));
    await tick();

    harness.final("only once ");
    await session.stop();
    await session.stop();

    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });
});
