// Async stage: AI grammar/punctuation polish. Two interchangeable backends,
// chosen by settings.polishProvider:
//
//   "chrome"     — Chrome's built-in Gemini Nano (free, on-device, but needs
//                  a capable machine and a one-time model download)
//   "cloudflare" — a Workers AI text model on the user's own account (works
//                  on ANY machine; the same credentials as the CF ASR engines)
//
// This is where "you don't have to say comma" comes from: the model reads the
// whole transcript and punctuates it by grammar. Finals only — too slow for
// the partial path. Never blocks text insertion past its budget; on timeout
// or failure the rule-based text is kept.

import type { Settings } from "../../shared/types";
import type { AsyncStage } from "../processor";

const SYSTEM_PROMPT =
  "You correct dictated text. Fix grammar, punctuation, capitalization, and " +
  "sentence boundaries so it reads like clean writing. Keep the wording and " +
  "meaning — do not add, remove, answer, or comment on the content. Reply " +
  "with ONLY the corrected text, no preamble or quotes.";

/** On-device polish must finish fast; it's competing with instant insertion. */
export const POLISH_BUDGET_MS = 1200;
/** Cloud polish is the primary quality path, so it gets a real network budget. */
export const CLOUD_BUDGET_MS = 6000;

// ---------------------------------------------------------------- shared

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Guard against a model that ignores the instruction and rambles or truncates.
export function acceptPolish(out: string, input: string): string | null {
  let t = out.trim().replace(/^["“]|["”]$/g, "");
  if (!t) return null;
  if (t.length > input.length * 1.6 + 60) return null;
  if (t.length < input.length * 0.5) return null;
  return t;
}

// ---------------------------------------------------------------- Gemini Nano

declare const LanguageModel:
  | {
      availability(opts?: unknown): Promise<string>;
      create(opts: unknown): Promise<{ prompt(text: string): Promise<string> }>;
    }
  | undefined;

// Chrome wants the output language declared on EVERY LanguageModel request.
const LANGUAGE_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

let sessionPromise: Promise<{ prompt(t: string): Promise<string> }> | null =
  null;

async function ensureSession() {
  if (typeof LanguageModel === "undefined") return null;
  try {
    const availability = await LanguageModel.availability(LANGUAGE_OPTS);
    if (
      availability !== "available" &&
      availability !== "downloadable" &&
      availability !== "downloading"
    ) {
      return null;
    }
    sessionPromise ??= LanguageModel.create({
      ...LANGUAGE_OPTS,
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    });
    return await sessionPromise;
  } catch {
    sessionPromise = null;
    return null;
  }
}

/** Warm the on-device model up while the user is still speaking. */
export function warmUpGrammar(settings: Settings): void {
  if (settings.aiPolish !== false && settings.polishProvider === "chrome") {
    void ensureSession().catch(() => {});
  }
}

async function polishNano(text: string): Promise<string | null> {
  const session = await withTimeout(ensureSession(), POLISH_BUDGET_MS);
  if (!session) return null;
  try {
    const raw = await withTimeout(session.prompt(text), POLISH_BUDGET_MS);
    if (raw === null) return null;
    return acceptPolish(raw, text);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- Cloudflare

async function polishCloudflare(
  text: string,
  settings: Settings,
): Promise<string | null> {
  const { cfAccountId, cfApiToken } = settings;
  if (!cfAccountId || !cfApiToken) return null;
  const model = settings.cfTextModel || "@cf/meta/llama-3.1-8b-instruct";

  // Model IDs contain "@" and "/" that Cloudflare wants literal in the path
  // (same as the Whisper engine), so the id is appended raw.
  const url =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(cfAccountId) +
    "/ai/run/" +
    model;

  const body = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0.2,
  };

  try {
    const json = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + cfApiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
      CLOUD_BUDGET_MS,
    );
    if (!json || !json.success) return null;
    const out: string = json.result?.response ?? "";
    return acceptPolish(out, text);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- the stage

export const grammarStage: AsyncStage = {
  id: "grammar-polish",
  appliesTo: (_kind, ctx) => ctx.settings.aiPolish !== false,
  async run(text, ctx) {
    if (!text.trim()) return null;
    return ctx.settings.polishProvider === "cloudflare"
      ? polishCloudflare(text, ctx.settings)
      : polishNano(text);
  },
};
