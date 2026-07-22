import { describe, expect, it } from "vitest";
import { SAVED_PROMPT_LIMITS, sanitizeSavedPrompt, suggestPromptName } from "../src/shared/prompts";
import type { SavedPrompt } from "../src/shared/types";

function prompt(overrides: Partial<SavedPrompt> = {}): SavedPrompt {
  return { id: "p1", name: "Name", text: "Text", ...overrides };
}

describe("sanitizeSavedPrompt", () => {
  it("trims name and text and mints an id for a new prompt", () => {
    const res = sanitizeSavedPrompt({ name: "  Standup  ", text: "  what I did today  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.prompt.name).toBe("Standup");
      expect(res.prompt.text).toBe("what I did today");
      expect(res.prompt.id).toBeTruthy();
    }
  });

  it("rejects an empty name with the name error", () => {
    const res = sanitizeSavedPrompt({ name: "   ", text: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Give the prompt a name.");
  });

  it("rejects an empty text with the text error", () => {
    const res = sanitizeSavedPrompt({ name: "x", text: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Nothing to save yet.");
  });

  it("rejects a name over the limit", () => {
    const res = sanitizeSavedPrompt({
      name: "x".repeat(SAVED_PROMPT_LIMITS.maxName + 1),
      text: "ok",
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a name exactly at the limit", () => {
    const res = sanitizeSavedPrompt({
      name: "x".repeat(SAVED_PROMPT_LIMITS.maxName),
      text: "ok",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects text over the limit", () => {
    const res = sanitizeSavedPrompt({
      name: "ok",
      text: "x".repeat(SAVED_PROMPT_LIMITS.maxText + 1),
    });
    expect(res.ok).toBe(false);
  });

  it("accepts text exactly at the limit", () => {
    const res = sanitizeSavedPrompt({
      name: "ok",
      text: "x".repeat(SAVED_PROMPT_LIMITS.maxText),
    });
    expect(res.ok).toBe(true);
  });

  it("caps the number of saved prompts", () => {
    const existing: SavedPrompt[] = Array.from(
      { length: SAVED_PROMPT_LIMITS.maxCount },
      (_, i) => prompt({ id: `id${i}` }),
    );
    const res = sanitizeSavedPrompt({ name: "One More", text: "do it" }, existing);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("You can save up to 20 prompts.");
  });

  it("lets an existing prompt be edited without counting against the cap", () => {
    const existing: SavedPrompt[] = Array.from(
      { length: SAVED_PROMPT_LIMITS.maxCount },
      (_, i) => prompt({ id: `id${i}` }),
    );
    const res = sanitizeSavedPrompt({ id: "id0", name: "Edited", text: "changed" }, existing);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.prompt.id).toBe("id0");
  });
});

describe("suggestPromptName", () => {
  it("passes short text through unchanged (after trimming)", () => {
    expect(suggestPromptName("  Quick note  ")).toBe("Quick note");
  });

  it("collapses internal whitespace", () => {
    expect(suggestPromptName("Too   many\n\nspaces  here")).toBe("Too many spaces here");
  });

  it("cuts long text at or under the max length, preferring a word boundary", () => {
    const long = "This is a much longer prompt than the name limit allows for sure";
    const name = suggestPromptName(long);
    expect(name.length).toBeLessThanOrEqual(SAVED_PROMPT_LIMITS.maxName);
    expect(long.startsWith(name)).toBe(true);
    expect(name.endsWith(" ")).toBe(false);
  });

  it("hard-cuts when a single word exceeds the max length", () => {
    const long = "x".repeat(SAVED_PROMPT_LIMITS.maxName + 10);
    const name = suggestPromptName(long);
    expect(name.length).toBe(SAVED_PROMPT_LIMITS.maxName);
  });
});
