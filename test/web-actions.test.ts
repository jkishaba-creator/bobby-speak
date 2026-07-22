// The web app must stay in lockstep with the pop-out: same shared actions,
// same mid-recording behavior, same recording visuals. Guarded at the source
// level like test/popout-actions.test.ts (no component runner in this repo).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(__dirname, "..", "web", "App.svelte"),
  "utf8",
);

describe("web app AI actions wiring", () => {
  it("imports the shared actions and gate from src/ai/textActions", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\brunTextAction\b[^}]*\}\s*from\s*["'][^"']*ai\/textActions["']/s,
    );
    expect(source).toContain("chipsUsable(");
    // The shared module owns the HTTP call; the app must not reimplement it.
    expect(source).not.toContain("api.cloudflare.com");
  });

  it("renders chips from resolveActions, not a hardcoded catalog", () => {
    expect(source).toContain("resolveActions(settings)");
    expect(source).not.toMatch(/TEXT_ACTIONS\s*[:=](?!=)/);
  });

  it("finishes an active recording before applying a chip", () => {
    // Same contract as the pop-out: tap mid-recording → stow the action, stop
    // the session, run it from the "done" handler on the final transcript.
    expect(source).toMatch(/if\s*\(listening\)\s*\{[^}]*pendingAction\s*=\s*action/s);
    expect(source).toMatch(/case\s*"done"[\s\S]*pendingAction/);
    // And a result that lands after a NEW recording started is dropped.
    expect(source).toMatch(/running\s*=\s*null;[\s\S]{0,250}if\s*\(listening\)\s*return/);
  });

  it("shows the recording state with the shared Air OS treatment", () => {
    // Accent crawling tick ring + breathing dot, disabled for reduced motion.
    expect(source).toContain("tick-ring");
    expect(source).toContain("rec-dot");
    expect(source).toMatch(/prefers-reduced-motion[\s\S]*tick-ring/);
  });

  it("wires saved prompts through the shared core, not a local reimplementation", () => {
    // The web app must import the shared validation/suggestion helpers rather
    // than forking its own copy, and drive the strip + settings sheet off
    // settings.savedPrompts.
    expect(source).toMatch(
      /import\s*\{[^}]*\bsanitizeSavedPrompt\b[^}]*\}\s*from\s*["'][^"']*shared\/prompts["']/s,
    );
    expect(source).toContain("suggestPromptName");
    expect(source).toContain("settings.savedPrompts");
    // Chips must be disabled while listening or while an AI action is running.
    expect(source).toMatch(/disabled=\{listening\s*\|\|\s*!!running\}/);
  });
});
