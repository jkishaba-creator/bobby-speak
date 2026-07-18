// Text cleanup — a JS port of the ideas in Handy's audio_toolkit/text.rs,
// extended with a grammar/punctuation pass for raw speech-engine output:
// filler removal, stutter collapse, spoken punctuation ("period", "new line"),
// auto-capitalization, and fuzzy custom-word correction.
// Loaded via importScripts() in the service worker; also usable in pages.

(function (root) {
  "use strict";

  // ---------- fillers & stutters ----------
  const FILLERS = [
    /\b(?:um+|uh+|uhm+|erm+|er|hmm+|mhm+)\b[,.]?\s*/gi,
    /\b(?:you know|i mean),?\s+/gi,
  ];

  function removeFillers(text) {
    let out = text;
    for (const re of FILLERS) out = out.replace(re, "");
    // collapse immediate word repeats ("the the" -> "the"), case-insensitive
    out = out.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");
    return out;
  }

  // ---------- spoken punctuation ----------
  // "meet me tomorrow period" -> "meet me tomorrow."
  const SPOKEN = [
    [/\s*\bnew paragraph\b\s*/gi, "\n\n"],
    [/\s*\bnew line\b\s*/gi, "\n"],
    [/\s*\b(?:full stop|period)\b/gi, "."],
    [/\s*\bcomma\b/gi, ","],
    [/\s*\bquestion mark\b/gi, "?"],
    [/\s*\bexclamation (?:mark|point)\b/gi, "!"],
    [/\s*\bsemicolon\b/gi, ";"],
    [/\s*\bcolon\b/gi, ":"],
  ];

  function applySpokenPunctuation(text) {
    let out = text;
    for (const [re, sub] of SPOKEN) out = out.replace(re, sub);
    return out;
  }

  // ---------- grammar / punctuation ----------
  // Speech engines emit lowercase, unpunctuated text; make it read like writing.
  function autoPunctuate(text) {
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

    // capitalize sentence starts (start of text, after . ! ?, after newline)
    out = out.replace(
      /(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g,
      (_, pre, ch) => pre + ch.toUpperCase()
    );

    // finish with terminal punctuation
    if (!/[.!?…"”')\]]$/.test(out)) out += ".";

    return out;
  }

  // ---------- fuzzy custom words ----------
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
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

  // Replace words that are a near-miss for a user's custom word.
  // threshold is a normalized distance (Handy defaults to 0.18).
  function applyCustomWords(text, customWords, threshold = 0.18) {
    if (!customWords || customWords.length === 0) return text;
    return text.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
      const lower = word.toLowerCase();
      let best = null;
      let bestScore = threshold + 1;
      for (const cw of customWords) {
        const cwLower = cw.toLowerCase();
        if (lower === cwLower) return cw; // exact (fix casing)
        const dist = levenshtein(lower, cwLower);
        const score = dist / Math.max(lower.length, cwLower.length);
        if (score < bestScore) {
          bestScore = score;
          best = cw;
        }
      }
      return best !== null && bestScore <= threshold ? best : word;
    });
  }

  // ---------- final whitespace pass ----------
  function tidy(text) {
    let out = text.replace(/[^\S\n]+/g, " ");
    out = out.replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    out = out.replace(/\s+([,.!?;:])/g, "$1");
    return out;
  }

  // ---------- the full pipeline ----------
  // opts: { removeFillers, spokenPunctuation, customWords }
  function clean(text, opts = {}) {
    let out = text || "";
    if (opts.removeFillers !== false) out = removeFillers(out);
    if (opts.spokenPunctuation !== false) out = applySpokenPunctuation(out);
    out = applyCustomWords(out, opts.customWords || []);
    out = autoPunctuate(out);
    return tidy(out);
  }

  root.TextCleanup = {
    clean,
    removeFillers,
    applySpokenPunctuation,
    autoPunctuate,
    applyCustomWords,
    tidy,
    levenshtein,
  };
})(typeof self !== "undefined" ? self : this);
