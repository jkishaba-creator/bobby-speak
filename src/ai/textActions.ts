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

import type { CustomAction, Settings, ToneId } from "../shared/types";
import { runCloudflareModel } from "./cloudflareClient";

export type TextActionId = "clean" | "summarize" | "sharpen" | "ask";

export interface TextAction {
  /** Built-in ids are the literals above; custom chips are "custom-…". */
  id: string;
  label: string;
  hint: string;
  /** "ask" needs a question from the user as well as the text. */
  needsQuestion?: boolean;
  system: string;
  /** Whether the tone setting is applied to this action (see runTextAction). */
  toneable?: boolean;
  /** User-authored chip — editable/deletable in the UI, unlike built-ins. */
  custom?: boolean;
}

export const TEXT_ACTIONS: TextAction[] = [
  {
    id: "clean",
    label: "Clean",
    hint: "Fix grammar and cut filler",
    toneable: true,
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
    toneable: true,
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

// ---------------------------------------------------------------------------
// Tone: an optional voice appended to toneable actions. The built-ins clean
// and sharpen are toneable, and every custom chip is; summarize and ask never
// are. "none" is a no-op.

export const TONES: { id: ToneId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "professional", label: "Professional" },
  { id: "direct", label: "Direct" },
  { id: "confident", label: "Confident" },
];

/** The line appended to a system prompt for a given tone; "" for "none". */
export function toneLine(tone: ToneId): string {
  if (tone === "none") return "";
  return `\n\nWrite the result in a ${tone} tone.`;
}

// ---------------------------------------------------------------------------
// Custom chips. The stored prompt is plain English; at runtime it is wrapped
// so the model returns only the transformed text and nothing else.

const CUSTOM_PROMPT_SUFFIX =
  "\n\nReply with ONLY the resulting text — no preamble, no quotes.";

const CUSTOM_ID_PREFIX = "custom-";

/** Wrap a plain-English instruction into a usable system prompt. */
export function wrapCustomPrompt(prompt: string): string {
  return prompt.trim() + CUSTOM_PROMPT_SUFFIX;
}

/** A one-line hint derived from the instruction, for the chip's tooltip. */
function deriveHint(prompt: string): string {
  const one = prompt.trim().replace(/\s+/g, " ");
  return one.length > 60 ? one.slice(0, 59).trimEnd() + "…" : one;
}

/** Turn a stored CustomAction into a runnable TextAction. */
export function customToTextAction(c: CustomAction): TextAction {
  return {
    id: CUSTOM_ID_PREFIX + c.id,
    label: c.label,
    hint: deriveHint(c.prompt),
    system: wrapCustomPrompt(c.prompt),
    toneable: true,
    custom: true,
  };
}

/**
 * The chip row the user actually sees: built-ins plus their custom chips,
 * reordered by settings.actionOrder (unknown/unlisted ids keep catalog order,
 * appended after), then with hidden ids removed. Built-ins are never dropped
 * from the catalog — only hidden — so they can always be un-hidden.
 */
export function resolveActions(settings: Settings): TextAction[] {
  const custom = (settings.customActions ?? []).map(customToTextAction);
  const catalog = [...TEXT_ACTIONS, ...custom];

  const byId = new Map(catalog.map((a) => [a.id, a]));
  const ordered: TextAction[] = [];
  const seen = new Set<string>();

  for (const id of settings.actionOrder ?? []) {
    const a = byId.get(id);
    if (a && !seen.has(id)) {
      ordered.push(a);
      seen.add(id);
    }
  }
  for (const a of catalog) {
    if (!seen.has(a.id)) {
      ordered.push(a);
      seen.add(a.id);
    }
  }

  const hidden = new Set(settings.hiddenActions ?? []);
  return ordered.filter((a) => !hidden.has(a.id));
}

// ---------------------------------------------------------------------------
// Validation. The UI calls these before writing settings.customActions.

export const CUSTOM_ACTION_LIMITS = {
  maxLabel: 16,
  maxPrompt: 500,
  maxCount: 12,
} as const;

export type SanitizeResult =
  | { ok: true; action: CustomAction }
  | { ok: false; error: string };

function newCustomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Trim, bound, and (for new chips) enforce the count cap. Pass the existing
 * list so the cap and the new-vs-update distinction can be checked; an input
 * `id` that already exists in `existing` is treated as an edit and does not
 * count against the cap. Returns a clean CustomAction or a user-facing error.
 */
export function sanitizeCustomAction(
  input: { id?: string; label: string; prompt: string },
  existing: CustomAction[] = [],
): SanitizeResult {
  const label = (input.label ?? "").trim();
  const prompt = (input.prompt ?? "").trim();

  if (!label) return { ok: false, error: "Give the chip a label." };
  if (label.length > CUSTOM_ACTION_LIMITS.maxLabel) {
    return {
      ok: false,
      error: `Label must be ${CUSTOM_ACTION_LIMITS.maxLabel} characters or fewer.`,
    };
  }
  if (!prompt) return { ok: false, error: "Add an instruction." };
  if (prompt.length > CUSTOM_ACTION_LIMITS.maxPrompt) {
    return {
      ok: false,
      error: `Instruction must be ${CUSTOM_ACTION_LIMITS.maxPrompt} characters or fewer.`,
    };
  }

  const isEdit = !!input.id && existing.some((a) => a.id === input.id);
  if (!isEdit && existing.length >= CUSTOM_ACTION_LIMITS.maxCount) {
    return {
      ok: false,
      error: `You can have up to ${CUSTOM_ACTION_LIMITS.maxCount} custom chips.`,
    };
  }

  return { ok: true, action: { id: input.id || newCustomId(), label, prompt } };
}

/**
 * Whether tapping an action chip can do something useful right now — the ONE
 * gating rule every surface (pop-out, web app) uses, so the behavior can't
 * drift between them. While recording there may be no committed text yet
 * (Whisper commits only on stop), but a tap is still meaningful — it finishes
 * the take and applies — so mid-recording the gate is just the credentials.
 * ("Ask" chips are exempt upstream: they open their question input first.)
 */
export function chipsUsable(
  listening: boolean,
  text: string,
  settings: Settings,
): boolean {
  const keysReady = !!settings.cfAccountId && !!settings.cfApiToken;
  return listening ? keysReady : keysReady && !!text.trim();
}

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

  // Tone applies only to toneable actions (built-in clean/sharpen and every
  // custom chip); it never touches summarize or ask. "none" is a no-op.
  const system = action.toneable
    ? action.system + toneLine(settings.tone ?? "none")
    : action.system;

  try {
    const resp = await runCloudflareModel(
      model,
      { accountId: cfAccountId, apiToken: cfApiToken },
      {
        messages: [
          { role: "system", content: system },
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
