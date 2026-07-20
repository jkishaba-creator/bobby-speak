// Async stage: on-device AI grammar polish via Chrome's built-in model
// (Gemini Nano / Prompt API). Finals only — too slow for the partial path.
// Feature-detected; returns null anywhere it can't run, and the pipeline
// keeps the rule-based text. Never triggers a model download itself.

import type { AsyncStage } from "../processor";

declare const LanguageModel:
  | {
      availability(): Promise<string>;
      create(opts: unknown): Promise<{ prompt(text: string): Promise<string> }>;
    }
  | undefined;

let sessionPromise: Promise<{ prompt(t: string): Promise<string> }> | null =
  null;

async function ensureSession() {
  if (typeof LanguageModel === "undefined") return null;
  try {
    if ((await LanguageModel.availability()) !== "available") return null;
    sessionPromise ??= LanguageModel.create({
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

export const grammarStage: AsyncStage = {
  id: "grammar-polish",
  appliesTo: (_kind, ctx) => ctx.settings.aiPolish !== false,
  async run(text) {
    if (!text.trim()) return null;
    const session = await ensureSession();
    if (!session) return null;
    try {
      let out = (await session.prompt(text)).trim();
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
