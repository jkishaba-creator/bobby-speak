// The global shortcut's pop-out routing must survive MV3 service-worker
// restarts. The worker idles out after ~30s and restarts cold; if the pop-out
// window id only lives in memory, the shortcut stops recognizing the focused
// pop-out and silently routes dictation to the offscreen document — recording
// happens, but the pop-out never shows its listening state. Guarded at the
// source level, same approach as the pop-out wiring tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(__dirname, "..", "entrypoints", "background.ts"),
  "utf8",
);

describe("background pop-out routing survives worker restarts", () => {
  it("rehydrates pop-out state from storage.session", () => {
    expect(source).toMatch(
      /chrome\.storage\.session\s*\.get\(\s*\[\s*"popoutWindowId",\s*"popoutListening"\s*\]/,
    );
    expect(source).toMatch(/chrome\.storage\.session\s*\.set\(/);
  });

  it("waits for rehydration before routing a shortcut press", () => {
    expect(source).toMatch(/smartToggle\(\)\s*\{\s*[^}]*await popoutStateReady/s);
  });

  it("recognizes the pop-out window by URL even with no remembered id", () => {
    // Stateless fallback: a popup window showing popout.html IS the pop-out,
    // whatever happened to the worker's memory in the meantime.
    expect(source).toContain("isPopoutWindow");
    expect(source).toMatch(/win\.type\s*!==\s*"popup"/);
    expect(source).toMatch(/popout\.html/);
  });

  it("persists every pop-out state transition", () => {
    // open, close, and listening-state reports must all write through, or a
    // worker restart between them reintroduces the bug.
    const persistCalls = source.match(/persistPopoutState\(\)/g) ?? [];
    expect(persistCalls.length).toBeGreaterThanOrEqual(4);
  });
});
