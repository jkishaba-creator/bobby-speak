// Guard ported from v1: a line of content indented less than its block
// scalar's base silently ends the block and breaks the whole workflow parse.
// GitHub only tells you AFTER you push; this catches it locally and in CI.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function lintBlockScalars(file: string): string[] {
  const problems: string[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  let block: { keyIndent: number; baseIndent: number | null; startLine: number } | null = null;

  lines.forEach((line, i) => {
    const indent = line.search(/\S/);
    if (block) {
      if (indent === -1) return;
      if (block.baseIndent === null) {
        block.baseIndent = indent;
        return;
      }
      if (indent >= block.baseIndent) return;
      const looksLikeYaml = /^\s*(-\s|[\w"'.\-]+\s*:)/.test(line);
      if (looksLikeYaml && indent <= block.keyIndent) {
        block = null;
        return;
      }
      problems.push(
        `line ${i + 1}: content at indent ${indent} is below the block scalar ` +
          `opened on line ${block.startLine} (base ${block.baseIndent})`,
      );
      block = null;
      return;
    }
    if (/^\s*[\w".-]+:\s*[|>][+-]?\s*(#.*)?$/.test(line)) {
      block = { keyIndent: indent, baseIndent: null, startLine: i + 1 };
    }
  });
  return problems;
}

describe("GitHub workflow files", () => {
  const dir = join(__dirname, "..", ".github", "workflows");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    it(`${name} block scalars are well-formed`, () => {
      expect(lintBlockScalars(join(dir, name))).toEqual([]);
    });
  }
});
