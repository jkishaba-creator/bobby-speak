// Text actions: request shape, response parsing, guards, and error paths —
// all without a network.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_ACTION_LIMITS,
  TEXT_ACTIONS,
  TONES,
  chipsUsable,
  resolveActions,
  runTextAction,
  sanitizeCustomAction,
  wrapCustomPrompt,
  type TextAction,
} from "../src/ai/textActions";
import {
  DEFAULT_SETTINGS,
  type CustomAction,
  type Settings,
} from "../src/shared/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    cfAccountId: "acct123",
    cfApiToken: "tok456",
    ...overrides,
  };
}

const action = (id: string): TextAction =>
  TEXT_ACTIONS.find((a) => a.id === id)!;

function mockResponse(text: string) {
  return vi.fn(async () => ({
    status: 200,
    json: async () => ({ success: true, result: { response: text } }),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("action catalog", () => {
  it("exposes clean, summarize, sharpen and ask", () => {
    expect(TEXT_ACTIONS.map((a) => a.id)).toEqual([
      "clean",
      "summarize",
      "sharpen",
      "ask",
    ]);
  });

  it("marks only ask as needing a question", () => {
    expect(TEXT_ACTIONS.filter((a) => a.needsQuestion).map((a) => a.id)).toEqual(
      ["ask"],
    );
  });
});

describe("runTextAction", () => {
  it("sends the action's system prompt and the text, and returns the result", async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      // Node/vitest has no chrome global, so the client uses the same-origin
      // proxy; api.cloudflare.com is unreachable from a browser page.
      expect(url).toBe("/api/ai");
      expect(init.headers["x-cf-account"]).toBe("acct123");
      expect(init.headers["x-cf-token"]).toBe("tok456");
      expect(init.headers["x-cf-model"]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      const body = JSON.parse(init.body);
      expect(body.messages[0].content).toBe(action("clean").system);
      expect(body.messages[1].content).toBe("um so i think its fine");
      return { status: 200, json: async () => ({ success: true, result: { response: "So I think it's fine." } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await runTextAction(action("clean"), "um so i think its fine", settings());
    expect(res).toEqual({ ok: true, text: "So I think it's fine." });
  });

  it("allows a summary to be far shorter than the input", async () => {
    vi.stubGlobal("fetch", mockResponse("- Ship on Friday"));
    const long = "We talked for a while about the release and eventually agreed that Friday works best for everyone involved.";
    const res = await runTextAction(action("summarize"), long, settings());
    expect(res).toEqual({ ok: true, text: "- Ship on Friday" });
  });

  it("packs the question and text together for ask", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const user = JSON.parse(init.body).messages[1].content;
      expect(user).toContain("Question: when are we shipping?");
      expect(user).toContain("Friday");
      return { status: 200, json: async () => ({ success: true, result: { response: "Friday." } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await runTextAction(action("ask"), "We ship Friday.", settings(), "when are we shipping?");
    expect(res).toEqual({ ok: true, text: "Friday." });
  });

  it("refuses ask without a question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await runTextAction(action("ask"), "some text", settings(), "  ");
    expect(res).toEqual({ ok: false, error: "Type a question first." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await runTextAction(action("clean"), "text", settings({ cfApiToken: "" }));
    expect(res).toEqual({ ok: false, error: "Add your Cloudflare keys in Settings first." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses empty text", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runTextAction(action("clean"), "   ", settings())).toEqual({
      ok: false,
      error: "Nothing to work with yet.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected token clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, json: async () => ({}) })));
    const res = await runTextAction(action("clean"), "text", settings());
    expect(res).toEqual({ ok: false, error: "Cloudflare rejected your API token." });
  });

  it("surfaces an API error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      json: async () => ({ success: false, errors: [{ message: "model unavailable" }] }),
    })));
    const res = await runTextAction(action("clean"), "text", settings());
    expect(res).toEqual({ ok: false, error: "model unavailable" });
  });

  it("survives a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await runTextAction(action("clean"), "text", settings());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Couldn't reach Cloudflare");
  });

  it("honors the configured model", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers["x-cf-model"]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      return { status: 200, json: async () => ({ success: true, result: { response: "ok" } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    await runTextAction(
      action("sharpen"),
      "text",
      settings({ cfTextModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("strips wrapping quotes the model sometimes adds", async () => {
    vi.stubGlobal("fetch", mockResponse('"Sharper version."'));
    const res = await runTextAction(action("sharpen"), "a wordy version", settings());
    expect(res).toEqual({ ok: true, text: "Sharper version." });
  });
});

// Capture the system prompt actually sent for a given action + settings.
async function systemSentFor(
  act: TextAction,
  over: Partial<Settings> = {},
): Promise<string> {
  let captured = "";
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    captured = JSON.parse(init.body).messages[0].content;
    return { status: 200, json: async () => ({ success: true, result: { response: "ok" } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  await runTextAction(act, "some text", settings(over), "a question?");
  return captured;
}

const custom = (over: Partial<CustomAction> = {}): CustomAction => ({
  id: "abc",
  label: "Emojify",
  prompt: "Add fitting emoji to the text",
  ...over,
});

describe("resolveActions", () => {
  it("defaults to exactly the built-ins, in catalog order", () => {
    expect(resolveActions(settings()).map((a) => a.id)).toEqual([
      "clean",
      "summarize",
      "sharpen",
      "ask",
    ]);
  });

  it("appends custom chips with a prefixed id and the custom flag", () => {
    const list = resolveActions(settings({ customActions: [custom()] }));
    const chip = list.find((a) => a.id === "custom-abc")!;
    expect(chip).toBeTruthy();
    expect(chip.label).toBe("Emojify");
    expect(chip.custom).toBe(true);
    expect(chip.toneable).toBe(true);
  });

  it("removes hidden ids", () => {
    const list = resolveActions(settings({ hiddenActions: ["summarize", "ask"] }));
    expect(list.map((a) => a.id)).toEqual(["clean", "sharpen"]);
  });

  it("respects actionOrder and appends unlisted ids in catalog order", () => {
    const list = resolveActions(
      settings({
        customActions: [custom()],
        actionOrder: ["custom-abc", "ask"],
      }),
    );
    expect(list.map((a) => a.id)).toEqual([
      "custom-abc",
      "ask",
      "clean",
      "summarize",
      "sharpen",
    ]);
  });

  it("ignores unknown ids in actionOrder", () => {
    const list = resolveActions(settings({ actionOrder: ["nope", "sharpen"] }));
    expect(list.map((a) => a.id)).toEqual([
      "sharpen",
      "clean",
      "summarize",
      "ask",
    ]);
  });

  it("hides a custom chip by its prefixed id", () => {
    const list = resolveActions(
      settings({ customActions: [custom()], hiddenActions: ["custom-abc"] }),
    );
    expect(list.some((a) => a.id === "custom-abc")).toBe(false);
  });
});

describe("custom chip prompt wrapping", () => {
  it("wraps the plain instruction with the only-the-text suffix", () => {
    const wrapped = wrapCustomPrompt("Add fitting emoji to the text");
    expect(wrapped).toBe(
      "Add fitting emoji to the text\n\nReply with ONLY the resulting text — no preamble, no quotes.",
    );
  });

  it("sends the wrapped prompt as the system message", async () => {
    const [chip] = resolveActions(settings({ customActions: [custom()] })).filter(
      (a) => a.id === "custom-abc",
    );
    const sent = await systemSentFor(chip);
    expect(sent).toContain("Add fitting emoji to the text");
    expect(sent).toContain("Reply with ONLY the resulting text");
  });
});

describe("tone", () => {
  it("exposes none/professional/direct/confident", () => {
    expect(TONES.map((t) => t.id)).toEqual([
      "none",
      "professional",
      "direct",
      "confident",
    ]);
  });

  it("appends a tone line to clean and sharpen", async () => {
    for (const id of ["clean", "sharpen"]) {
      const sent = await systemSentFor(action(id), { tone: "professional" });
      expect(sent).toContain("Write the result in a professional tone.");
    }
  });

  it("appends a tone line to custom chips", async () => {
    const [chip] = resolveActions(settings({ customActions: [custom()] })).filter(
      (a) => a.id === "custom-abc",
    );
    const sent = await systemSentFor(chip, { tone: "direct" });
    expect(sent).toContain("Write the result in a direct tone.");
  });

  it("never applies tone to summarize or ask", async () => {
    for (const id of ["summarize", "ask"]) {
      const sent = await systemSentFor(action(id), { tone: "confident" });
      expect(sent).toBe(action(id).system);
      expect(sent).not.toContain("tone.");
    }
  });

  it("appends nothing when tone is none", async () => {
    const sent = await systemSentFor(action("clean"), { tone: "none" });
    expect(sent).toBe(action("clean").system);
  });
});

describe("sanitizeCustomAction", () => {
  it("trims label and prompt and mints an id for a new chip", () => {
    const res = sanitizeCustomAction({ label: "  Emojify  ", prompt: "  add emoji  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.action.label).toBe("Emojify");
      expect(res.action.prompt).toBe("add emoji");
      expect(res.action.id).toBeTruthy();
    }
  });

  it("rejects an empty label or prompt", () => {
    expect(sanitizeCustomAction({ label: "   ", prompt: "x" }).ok).toBe(false);
    expect(sanitizeCustomAction({ label: "x", prompt: "  " }).ok).toBe(false);
  });

  it("rejects a label over the limit", () => {
    const res = sanitizeCustomAction({
      label: "x".repeat(CUSTOM_ACTION_LIMITS.maxLabel + 1),
      prompt: "ok",
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a label exactly at the limit", () => {
    const res = sanitizeCustomAction({
      label: "x".repeat(CUSTOM_ACTION_LIMITS.maxLabel),
      prompt: "ok",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a prompt over the limit", () => {
    const res = sanitizeCustomAction({
      label: "ok",
      prompt: "x".repeat(CUSTOM_ACTION_LIMITS.maxPrompt + 1),
    });
    expect(res.ok).toBe(false);
  });

  it("caps the number of custom chips", () => {
    const existing: CustomAction[] = Array.from(
      { length: CUSTOM_ACTION_LIMITS.maxCount },
      (_, i) => custom({ id: `id${i}` }),
    );
    const res = sanitizeCustomAction({ label: "One More", prompt: "do it" }, existing);
    expect(res.ok).toBe(false);
  });

  it("lets an existing chip be edited without counting against the cap", () => {
    const existing: CustomAction[] = Array.from(
      { length: CUSTOM_ACTION_LIMITS.maxCount },
      (_, i) => custom({ id: `id${i}` }),
    );
    const res = sanitizeCustomAction(
      { id: "id0", label: "Edited", prompt: "changed" },
      existing,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.action.id).toBe("id0");
  });
});

describe("chipsUsable — the one gating rule for every surface", () => {
  it("requires keys plus text when idle", () => {
    expect(chipsUsable(false, "some text", settings())).toBe(true);
    expect(chipsUsable(false, "   ", settings())).toBe(false);
    expect(chipsUsable(false, "text", settings({ cfApiToken: "" }))).toBe(false);
  });

  it("requires only keys while recording (Whisper has no text until stop)", () => {
    expect(chipsUsable(true, "", settings())).toBe(true);
    expect(chipsUsable(true, "", settings({ cfAccountId: "" }))).toBe(false);
  });
});

describe("model defaults", () => {
  it("does not ship a retired model as the default", () => {
    // Cloudflare retired llama-3.1-8b-instruct on 2026-05-30; shipping a dead
    // model as the default silently breaks every AI call.
    expect([
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/meta/llama-3.1-8b-instruct-fast",
      "@cf/meta/llama-3-8b-instruct",
    ]).not.toContain(DEFAULT_SETTINGS.cfTextModel);
  });
});
