// Segment joining — cases taken verbatim from real dictated output, where
// Chrome's engine capitalized the first word of every post-pause chunk.

import { describe, expect, it } from "vitest";
import { joinSegments } from "../src/processing/join";

describe("joinSegments", () => {
  it("lowercases a stranded capital at a mid-sentence join", () => {
    expect(
      joinSegments("we're gonna make it work right after", "Is it a good workflow", []),
    ).toBe("we're gonna make it work right after is it a good workflow");
  });

  it("fixes the real-world 'that It works' case", () => {
    expect(joinSegments("can we make sure that", "It works by default", [])).toBe(
      "can we make sure that it works by default",
    );
  });

  it("keeps I and its contractions capitalized", () => {
    expect(joinSegments("and then", "I'll try it", [])).toBe("and then I'll try it");
    expect(joinSegments("and", "I think so", [])).toBe("and I think so");
  });

  it("preserves the user's custom words", () => {
    expect(joinSegments("using", "Chrome every day", ["Chrome"])).toBe(
      "using Chrome every day",
    );
  });

  it("preserves acronyms", () => {
    expect(joinSegments("using the", "API keys", [])).toBe("using the API keys");
  });

  it("keeps the capital after a sentence end", () => {
    expect(joinSegments("That's done.", "Next thing", [])).toBe(
      "That's done. Next thing",
    );
  });

  it("handles empty previous text", () => {
    expect(joinSegments("", "Hello there", [])).toBe("Hello there");
  });

  it("normalizes the whitespace seam", () => {
    expect(joinSegments("left side   ", "  Right side", [])).toBe(
      "left side right side",
    );
  });
});
