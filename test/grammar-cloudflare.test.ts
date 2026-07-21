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
      // In vitest (no chrome global) the client takes the same-origin proxy
      // path, not api.cloudflare.com — browsers are blocked from the latter
      // by CORS. Credentials ride in x-cf-* headers.
      expect(url).toBe("/api/ai");
      expect(init.headers["x-cf-account"]).toBe("acct123");
      expect(init.headers["x-cf-token"]).toBe("tok456");
      expect(init.headers["x-cf-model"]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
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
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers["x-cf-model"]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      return { json: async () => ({ success: true, result: { response: "Fixed." } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await grammarStage.run("fix", ctx({ cfTextModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }));
    expect(out).toBe("Fixed.");
  });

  it("calls api.cloudflare.com directly with a Bearer token in extension context", async () => {
    // Inside the Chrome extension, host permissions bypass CORS and there is
    // no same-origin proxy — the client must hit Cloudflare directly. A chrome
    // global with runtime.id is what marks that context; afterEach unstubs it.
    vi.stubGlobal("chrome", { runtime: { id: "abc123" } });
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      );
      expect(init.headers.Authorization).toBe("Bearer tok456");
      expect(init.headers["x-cf-account"]).toBeUndefined();
      return {
        json: async () => ({ success: true, result: { response: "Hello world." } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await grammarStage.run("hello world", ctx());
    expect(out).toBe("Hello world.");
    expect(fetchMock).toHaveBeenCalledOnce();
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
