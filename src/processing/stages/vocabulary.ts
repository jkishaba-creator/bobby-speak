// Stage: fuzzy custom-word correction (Levenshtein near-miss → user spelling).
// Ported from v1; the idea traces back to Handy's text.rs.

import type { SyncStage } from "../processor";

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

const THRESHOLD = 0.18; // normalized distance, Handy's default

export const vocabularyStage: SyncStage = {
  id: "vocabulary",
  appliesTo: (_kind, ctx) => ctx.settings.customWords.length > 0,
  run(text, ctx) {
    const words = ctx.settings.customWords;
    return text.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
      const lower = word.toLowerCase();
      let best: string | null = null;
      let bestScore = THRESHOLD + 1;
      for (const cw of words) {
        const cwLower = cw.toLowerCase();
        if (lower === cwLower) return cw; // exact (fix casing)
        const dist = levenshtein(lower, cwLower);
        const score = dist / Math.max(lower.length, cwLower.length);
        if (score < bestScore) {
          bestScore = score;
          best = cw;
        }
      }
      return best !== null && bestScore <= THRESHOLD ? best : word;
    });
  },
};
