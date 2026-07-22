// Saved-prompts core: validation and id/name helpers shared by every surface
// (pop-out, web app, options page, web settings sheet). No UI here.

import type { SavedPrompt } from "./types";

export const SAVED_PROMPT_LIMITS = {
  maxName: 24,
  maxText: 2000,
  maxCount: 20,
} as const;

export type SanitizePromptResult =
  | { ok: true; prompt: SavedPrompt }
  | { ok: false; error: string };

function newPromptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Trim, bound, and (for new prompts) enforce the count cap. Pass the existing
 * list so the cap and the new-vs-edit distinction can be checked; an input
 * `id` that already exists in `existing` is treated as an edit and does not
 * count against the cap. Returns a clean SavedPrompt or a user-facing error.
 */
export function sanitizeSavedPrompt(
  input: { id?: string; name: string; text: string },
  existing: SavedPrompt[] = [],
): SanitizePromptResult {
  const name = (input.name ?? "").trim();
  const text = (input.text ?? "").trim();

  if (!name) return { ok: false, error: "Give the prompt a name." };
  if (name.length > SAVED_PROMPT_LIMITS.maxName) {
    return {
      ok: false,
      error: `Name must be ${SAVED_PROMPT_LIMITS.maxName} characters or fewer.`,
    };
  }
  if (!text) return { ok: false, error: "Nothing to save yet." };
  if (text.length > SAVED_PROMPT_LIMITS.maxText) {
    return {
      ok: false,
      error: `Prompt must be ${SAVED_PROMPT_LIMITS.maxText} characters or fewer.`,
    };
  }

  const isEdit = !!input.id && existing.some((p) => p.id === input.id);
  if (!isEdit && existing.length >= SAVED_PROMPT_LIMITS.maxCount) {
    return {
      ok: false,
      error: `You can save up to ${SAVED_PROMPT_LIMITS.maxCount} prompts.`,
    };
  }

  return { ok: true, prompt: { id: input.id || newPromptId(), name, text } };
}

/**
 * Suggest a name from the start of a prompt's text: collapse whitespace, then
 * cut at maxName characters, preferring a word boundary so the suggestion
 * doesn't end mid-word.
 */
export function suggestPromptName(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length <= SAVED_PROMPT_LIMITS.maxName) return collapsed;

  const cut = collapsed.slice(0, SAVED_PROMPT_LIMITS.maxName);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed.trim();
}
