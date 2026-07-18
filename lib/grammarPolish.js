// Optional on-device AI grammar polish via Chrome's built-in model
// (Prompt API / Gemini Nano). Feature-detected: returns null anywhere the
// API or model isn't available, and callers fall back to the rule-based
// TextCleanup pipeline. Never triggers a model download itself.

(function (root) {
  "use strict";

  let sessionPromise = null;

  async function ensureSession() {
    if (typeof LanguageModel === "undefined") return null;
    try {
      const availability = await LanguageModel.availability();
      if (availability !== "available") return null;
      if (!sessionPromise) {
        sessionPromise = LanguageModel.create({
          initialPrompts: [
            {
              role: "system",
              content:
                "You correct dictated text. Fix grammar, punctuation, and " +
                "capitalization only. Keep the wording and meaning. Never add, " +
                "remove, or answer content. Reply with the corrected text only.",
            },
          ],
        });
      }
      return await sessionPromise;
    } catch (_) {
      sessionPromise = null;
      return null;
    }
  }

  // Returns polished text, or null when unavailable / implausible output.
  async function polish(text) {
    if (!text || !text.trim()) return null;
    const session = await ensureSession();
    if (!session) return null;
    try {
      let out = (await session.prompt(text)).trim();
      if (!out) return null;
      out = out.replace(/^["“]|["”]$/g, "");
      // Reject rambles: polish should stay close to the input's length.
      if (out.length > text.length * 1.6 + 60) return null;
      if (out.length < text.length * 0.5) return null;
      return out;
    } catch (_) {
      return null;
    }
  }

  root.GrammarPolish = { polish };
})(typeof self !== "undefined" ? self : this);
