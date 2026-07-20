// Cloudflare formatter: verify request shape, response parsing, credential
// guards, and the ramble/truncation rejection — all without a network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { grammarStage, acceptPolish } from "../src/processing/stages/grammar";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";

function ctx(overrides: Partial<Settings> = {}) {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      aiPolish: true,
      polishProvider: "cloudflare" as const,
      cfAccountId: "acct123",
      cfApiToken: "tok456",
      ...overrides,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("acceptPolish", () => {
  it("accepts a clean correction and strips wrapping quotes", () => {
    expect(acceptPolish('"Hello world."', "hello world")).toBe("Hello world.");
  });
  it("rejects a rambling response", () => {
    const long = "Sure! Here is your corrected text: ".repeat(6);
    expect(acceptPolish(long, "hi")).toBeNull();
  });
  it("rejects a truncated response", () => {
    expect(acceptPolish("H", "hello world this is long")).toBeNull();
  });
});

describe("grammarStage via Cloudflare", () => {
  it("posts to the Workers AI run endpoint and returns the formatted text", async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toContain("/accounts/acct123/ai/run/@cf/meta/llama-3.1-8b-instruct");
      expect(init.headers.Authorization).toBe("Bearer tok456");
      const body = JSON.parse(init.body);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].content).toBe("hello world how are you");
      return {
        json: async () => ({ success: true, result: { response: "Hello world, how are you?" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await grammarStage.run("hello world how are you", ctx());
    expect(out).toBe("Hello world, how are you?");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors the chosen model", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      return { json: async () => ({ success: true, result: { response: "Fixed." } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await grammarStage.run("fix", ctx({ cfTextModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }));
    expect(out).toBe("Fixed.");
  });

  it("returns null (keeps rule-based text) without credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await grammarStage.run("hello", ctx({ cfApiToken: "" }));
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on an API failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ success: false, errors: [{ message: "bad token" }] }),
    })));
    expect(await grammarStage.run("hello world", ctx())).toBeNull();
  });

  it("returns null on a network throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await grammarStage.run("hello world", ctx())).toBeNull();
  });

  it("does not run for empty text", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await grammarStage.run("   ", ctx())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
