// On-demand text actions: take what you just dictated and clean it, condense
// it, sharpen it, or ask a question about it.
//
// Deliberately separate from the grammar-polish stage. Polish runs
// automatically and must stay close to the original (its guard rejects big
// length changes). These are user-invoked and are *supposed* to change the
// text a lot — a summary is meant to be much shorter.
//
// Shared, not web-only: the extension can wire the same actions into its
// pop-out without reimplementing anything.

import type { Settings } from "../shared/types";
import { runCloudflareModel } from "./cloudflareClient";

export type TextActionId = "clean" | "summarize" | "sharpen" | "ask";

export interface TextAction {
  id: TextActionId;
  label: string;
  hint: string;
  /** "ask" needs a question from the user as well as the text. */
  needsQuestion?: boolean;
  system: string;
}

export const TEXT_ACTIONS: TextAction[] = [
  {
    id: "clean",
    label: "Clean",
    hint: "Fix grammar and cut filler",
    system:
      "Rewrite the user's dictated text so it reads like clean writing: fix " +
      "grammar, punctuation, and capitalization, and remove filler words, " +
      "stutters, and false starts. Keep the meaning, the tone, and roughly " +
      "the same length. Reply with ONLY the rewritten text.",
  },
  {
    id: "summarize",
    label: "Summarize",
    hint: "Condense to the key points",
    system:
      "Summarize the user's text down to its key points. Be concise. If " +
      "there are several distinct points, use short lines each starting with " +
      '"- ". Do not add information that is not in the text. Reply with ' +
      "ONLY the summary.",
  },
  {
    id: "sharpen",
    label: "Sharpen",
    hint: "Make it direct and punchy",
    system:
      "Rewrite the user's text to be sharper and more direct: cut hedging, " +
      "redundancy, and throat-clearing; prefer active voice; keep it natural " +
      "and professional rather than terse. Preserve every substantive point. " +
      "Reply with ONLY the rewritten text.",
  },
  {
    id: "ask",
    label: "Ask",
    hint: "Ask a question about it",
    needsQuestion: true,
    system:
      "Answer the user's question using the provided text as the source. Be " +
      "concise and specific. If the text does not contain the answer, say so " +
      "plainly. Reply with ONLY the answer.",
  },
];

/** These can take longer than auto-polish; the user is watching a spinner. */
export const ACTION_TIMEOUT_MS = 20000;

export type ActionResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

function buildUserMessage(
  action: TextAction,
  text: string,
  question?: string,
): string {
  if (!action.needsQuestion) return text;
  return `Text:\n"""\n${text}\n"""\n\nQuestion: ${question ?? ""}`.trim();
}

export async function runTextAction(
  action: TextAction,
  text: string,
  settings: Settings,
  question?: string,
): Promise<ActionResult> {
  if (!text.trim()) return { ok: false, error: "Nothing to work with yet." };
  if (action.needsQuestion && !question?.trim()) {
    return { ok: false, error: "Type a question first." };
  }

  const { cfAccountId, cfApiToken } = settings;
  if (!cfAccountId || !cfApiToken) {
    return { ok: false, error: "Add your Cloudflare keys in Settings first." };
  }

  const model = settings.cfTextModel || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS);

  try {
    const resp = await runCloudflareModel(
      model,
      { accountId: cfAccountId, apiToken: cfApiToken },
      {
        messages: [
          { role: "system", content: action.system },
          { role: "user", content: buildUserMessage(action, text, question) },
        ],
        temperature: 0.3,
      },
      controller.signal,
    );

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, error: "Cloudflare rejected your API token." };
    }
    if (resp.status === 404) {
      return { ok: false, error: "Cloudflare account or model not found." };
    }

    const json = await resp.json();
    if (!json?.success) {
      return {
        ok: false,
        error: json?.errors?.[0]?.message ?? "The AI request failed.",
      };
    }

    const out = String(json.result?.response ?? "")
      .trim()
      .replace(/^["“]|["”]$/g, "");
    if (!out) return { ok: false, error: "The model returned nothing." };
    return { ok: true, text: out };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, error: "That took too long — try again." };
    }
    return { ok: false, error: "Couldn't reach Cloudflare — check your connection." };
  } finally {
    clearTimeout(timer);
  }
}
