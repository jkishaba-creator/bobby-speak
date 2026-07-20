// Async stage: on-device AI grammar polish via Chrome's built-in model
// (Gemini Nano / Prompt API). Finals only — too slow for the partial path.
//
// Two hard rules, learned the hard way:
//   1. It is NEVER allowed to block text insertion for long. The rule-based
//      output is already good; polish is a bonus that must beat a deadline.
//   2. The session is warmed up when dictation STARTS, not when it ends, so
//      first-use model loading overlaps with the user talking instead of
//      landing on the critical path.

import type { AsyncStage } from "../processor";

declare const LanguageModel:
  | {
      availability(opts?: unknown): Promise<string>;
      create(opts: unknown): Promise<{ prompt(text: string): Promise<string> }>;
    }
  | undefined;

// Chrome wants the output language declared on EVERY LanguageModel request —
// availability probes included — or it logs a warning to the extension's
// error panel.
const LANGUAGE_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

/** Polish must finish inside this budget or it is abandoned. */
export const POLISH_BUDGET_MS = 1200;

let sessionPromise: Promise<{ prompt(t: string): Promise<string> }> | null =
  null;

async function ensureSession() {
  if (typeof LanguageModel === "undefined") return null;
  try {
    const availability = await LanguageModel.availability(LANGUAGE_OPTS);
    // "downloadable"/"downloading": create() attaches to (or kicks off) the
    // one-time model download instead of silently never polishing. When
    // Chrome requires user activation for the download, create() rejects,
    // we return null, and a later attempt from a visible page succeeds.
    if (
      availability !== "available" &&
      availability !== "downloadable" &&
      availability !== "downloading"
    ) {
      return null;
    }
    sessionPromise ??= LanguageModel.create({
      ...LANGUAGE_OPTS,
      initialPrompts: [
        {
          role: "system",
          content:
            "You correct dictated text. Fix grammar, punctuation, and " +
            "capitalization only. Keep the wording and meaning. Never add, " +
            "remove, or answer content. Reply with the corrected text only.",
        },
      ],
    });
    return await sessionPromise;
  } catch {
    sessionPromise = null;
    return null;
  }
}

/** Start loading the model while the user is still speaking. Fire and forget. */
export function warmUpGrammar(): void {
  void ensureSession().catch(() => {});
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export const grammarStage: AsyncStage = {
  id: "grammar-polish",
  appliesTo: (_kind, ctx) => ctx.settings.aiPolish !== false,
  async run(text) {
    if (!text.trim()) return null;

    const session = await withTimeout(ensureSession(), POLISH_BUDGET_MS);
    if (!session) return null; // unavailable, or still loading — skip it

    try {
      const raw = await withTimeout(session.prompt(text), POLISH_BUDGET_MS);
      if (raw === null) return null; // over budget; keep the rule-based text
      let out = raw.trim();
      if (!out) return null;
      out = out.replace(/^["“]|["”]$/g, "");
      // Reject rambles: polish should stay close to the input's length.
      if (out.length > text.length * 1.6 + 60) return null;
      if (out.length < text.length * 0.5) return null;
      return out;
    } catch {
      return null;
    }
  },
};
