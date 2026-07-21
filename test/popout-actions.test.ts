// The pop-out must wire in the *shared* text actions, not fork its own copy.
// There's no Svelte component runner in this repo (no jsdom / testing-library
// and no new deps allowed), so we guard the wiring at the source level: the
// pop-out imports TEXT_ACTIONS + runTextAction from the shared module, calls
// runTextAction, and never redefines the action catalog.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT_ACTIONS } from "../src/ai/textActions";

const source = readFileSync(
  join(__dirname, "..", "entrypoints", "popout", "App.svelte"),
  "utf8",
);

describe("pop-out AI actions wiring", () => {
  it("imports the shared actions from src/ai/textActions", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bTEXT_ACTIONS\b[^}]*\brunTextAction\b[^}]*\}\s*from\s*["'][^"']*ai\/textActions["']/s,
    );
  });

  it("invokes runTextAction rather than calling Cloudflare directly", () => {
    expect(source).toContain("runTextAction(");
    // The shared module owns the HTTP call; the pop-out must not reimplement it.
    expect(source).not.toContain("api.cloudflare.com");
  });

  it("does not redefine the action catalog", () => {
    expect(source).not.toMatch(/TEXT_ACTIONS\s*[:=]/);
    // Every action id should be reached through the shared array, not literals.
    for (const a of TEXT_ACTIONS) {
      expect(source).not.toContain(`id: "${a.id}"`);
    }
  });

  it("provides Undo and an inline Ask question input", () => {
    expect(source).toContain("Undo");
    expect(source).toContain("askOpen");
    expect(source).toContain("applyAction(askAction)");
  });

  it("gates the chips on transcript text plus Cloudflare credentials", () => {
    expect(source).toMatch(/actionsReady\s*=\s*\$derived/);
    expect(source).toContain("settings.cfAccountId");
    expect(source).toContain("settings.cfApiToken");
  });
});
