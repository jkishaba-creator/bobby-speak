// The v1 grammar suite, ported against the staged pipeline. Same expected
// outputs — V2 must not regress a single case v1 got right. Includes the
// literal-punctuation cases from v1 PR #3 (@jpachec0).

import { describe, expect, it } from "vitest";
import {
  runSyncPipeline,
  type ProcessorContext,
  type SyncStage,
} from "../src/processing/processor";
import { fillersStage } from "../src/processing/stages/fillers";
import { spokenPunctuationStage } from "../src/processing/stages/spoken-punctuation";
import {
  capitalizationStage,
  finalTidyStage,
} from "../src/processing/stages/capitalization";
import { vocabularyStage } from "../src/processing/stages/vocabulary";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";

const STAGES: SyncStage[] = [
  fillersStage,
  spokenPunctuationStage,
  vocabularyStage,
  capitalizationStage,
  finalTidyStage,
];

function clean(text: string, overrides: Partial<Settings> = {}): string {
  const ctx: ProcessorContext = {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
  };
  return runSyncPipeline(STAGES, { kind: "final", text }, ctx).text;
}

describe("full pipeline (v1 parity)", () => {
  const cases: Array<[string, string, Partial<Settings>, string]> = [
    ["removes fillers", "um so i think we should ship it", {}, "So I think we should ship it."],
    ["collapses stutters", "the the deploy is is ready", {}, "The deploy is ready."],
    ["capitalizes standalone i", "i'm sure i'll go", {}, "I'm sure I'll go."],
    ["adds a terminal period", "is this working", {}, "Is this working."],
    ["spoken period and question mark", "hello world period how are you question mark", {}, "Hello world. How are you?"],
    ["spoken comma", "meet me tomorrow comma maybe at noon period", {}, "Meet me tomorrow, maybe at noon."],
    ["spoken new line", "first point new line second point", {}, "First point\nSecond point."],
    ["spoken new paragraph", "dear team new paragraph the launch is friday", {}, "Dear team\n\nThe launch is friday."],
    ["respects spokenPunctuation off", "this stays period", { spokenPunctuation: false }, "This stays period."],
    ["fuzzy-corrects custom words", "i talked to kubernets yesterday", { customWords: ["Kubernetes"] }, "I talked to Kubernetes yesterday."],
    ["fixes casing of exact custom words", "we use postgresql here", { customWords: ["PostgreSQL"] }, "We use PostgreSQL here."],
    ["leaves unrelated words alone", "the giraffe is tall", { customWords: ["Kubernetes"] }, "The giraffe is tall."],
    ["handles empty input", "", {}, ""],
    // PR #3 — literal spoken-punctuation words after determiners
    ["leaves literal period after determiner", "during that period we grew fast", {}, "During that period we grew fast."],
    ["leaves literal comma after article", "please insert a comma here", {}, "Please insert a comma here."],
    ["leaves literal new line after article", "write this on a new line later", {}, "Write this on a new line later."],
    ["literal and real punctuation together", "during that period comma we grew", {}, "During that period, we grew."],
  ];

  for (const [name, input, overrides, expected] of cases) {
    it(name, () => {
      expect(clean(input, overrides)).toBe(expected);
    });
  }
});

describe("partials", () => {
  it("never appends a terminal period to a partial", () => {
    const ctx: ProcessorContext = { settings: { ...DEFAULT_SETTINGS } };
    const out = runSyncPipeline(
      STAGES,
      { kind: "partial", text: "hello wor" },
      ctx,
    );
    expect(out.text).toBe("Hello wor");
  });
});
