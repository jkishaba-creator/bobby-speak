// Stage: filler-word removal + stutter collapse. Ported from v1's
// lib/textCleanup.js (itself a JS reimagining of Handy's text.rs ideas).

import type { SyncStage } from "../processor";

const FILLERS = [
  /\b(?:um+|uh+|uhm+|erm+|er|hmm+|mhm+)\b[,.]?\s*/gi,
  /\b(?:you know|i mean),?\s+/gi,
];

export const fillersStage: SyncStage = {
  id: "fillers",
  appliesTo: (_kind, ctx) => ctx.settings.removeFillers !== false,
  run(text) {
    let out = text;
    for (const re of FILLERS) out = out.replace(re, "");
    // collapse immediate word repeats ("the the" -> "the")
    out = out.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");
    return out;
  },
};
