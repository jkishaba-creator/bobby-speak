// Text actions: request shape, response parsing, guards, and error paths —
// all without a network.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEXT_ACTIONS,
  runTextAction,
  type TextAction,
} from "../src/ai/textActions";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";

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
      expect(url).toContain("/accounts/acct123/ai/run/@cf/meta/llama-3.1-8b-instruct");
      expect(init.headers.Authorization).toBe("Bearer tok456");
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
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
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
