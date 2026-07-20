// Stage: spoken punctuation — "period", "comma", "new line" become the mark.
//
// Includes the literal-word protection contributed by @jpachec0 in v1 PR #3:
// after a determiner ("that period", "a comma") the word is almost certainly
// meant literally, so it is shielded before substitution and restored after.

import type { SyncStage } from "../processor";

const SPOKEN: Array<[RegExp, string]> = [
  [/\s*\bnew paragraph\b\s*/gi, "\n\n"],
  [/\s*\bnew line\b\s*/gi, "\n"],
  [/\s*\b(?:full stop|period)\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (?:mark|point)\b/gi, "!"],
  [/\s*\bsemicolon\b/gi, ";"],
  [/\s*\bcolon\b/gi, ":"],
];

const LITERAL_GUARD =
  /\b(?:a|an|the|this|that|these|those)\s+(?:new paragraph|new line|full stop|period|comma|question mark|exclamation (?:mark|point)|semicolon|colon)\b/gi;

export const spokenPunctuationStage: SyncStage = {
  id: "spoken-punctuation",
  appliesTo: (_kind, ctx) => ctx.settings.spokenPunctuation !== false,
  run(text) {
    const literals: string[] = [];
    let out = text.replace(LITERAL_GUARD, (match) => {
      const token = "__BOBBY_LITERAL_" + literals.length + "__";
      literals.push(match);
      return token;
    });
    for (const [re, sub] of SPOKEN) out = out.replace(re, sub);
    literals.forEach((literal, i) => {
      out = out.replace("__BOBBY_LITERAL_" + i + "__", literal);
    });
    return out;
  },
};
