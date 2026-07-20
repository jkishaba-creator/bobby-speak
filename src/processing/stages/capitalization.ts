// Stage: capitalization + punctuation hygiene + final tidy. Ported from v1.

import type { SyncStage } from "../processor";

export const capitalizationStage: SyncStage = {
  id: "capitalization",
  appliesTo: () => true,
  run(text) {
    // collapse runs of spaces/tabs but keep newlines from "new paragraph"
    let out = text.replace(/[^\S\n]+/g, " ").trim();
    if (!out) return out;

    // standalone "i" and contractions -> "I"
    out = out.replace(/\bi(?=$|[\s,.!?;:]|['’](?:m|ll|ve|d|s)\b)/g, "I");

    // space after mid-sentence punctuation when a letter follows
    out = out.replace(/([,;:!?])([A-Za-zÀ-ÿ])/g, "$1 $2");

    // no space before punctuation
    out = out.replace(/\s+([,.!?;:])/g, "$1");

    // dedupe accidental doubles (",." / "?." / "..")
    out = out.replace(/([,;:])\s*([.!?])/g, "$2");
    out = out.replace(/([.!?,;:])\1+/g, "$1");

    // capitalize sentence starts
    out = out.replace(
      /(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g,
      (_m, pre: string, ch: string) => pre + ch.toUpperCase(),
    );

    return out;
  },
};

/** Final-only: terminal punctuation + whitespace tidy. Partials must NOT get
 *  a period appended while the user is mid-sentence. */
export const finalTidyStage: SyncStage = {
  id: "final-tidy",
  appliesTo: (kind) => kind === "final",
  run(text) {
    let out = text.replace(/[^\S\n]+/g, " ");
    out = out.replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    out = out.replace(/\s+([,.!?;:])/g, "$1");
    if (out && !/[.!?…"”')\]]$/.test(out)) out += ".";
    return out;
  },
};
