// Chrome's built-in Web Speech API. Free, zero setup, streaming.
// Quirk kept inside this file: SpeechRecognition captures its own audio, so
// the pipeline's audio stream is unused here (the level meter still uses it).

import type { AsrContext, AsrProvider } from "../provider";

// Minimal structural types — TS's DOM lib doesn't ship SpeechRecognition.
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRErrorEvent { error: string }
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SRCtor = new () => SRInstance;

export function chromeSpeechProvider(): AsrProvider {
  let recognition: SRInstance | null = null;
  let active = false;

  return {
    id: "chrome",
    label: "Chrome built-in",
    streaming: true,

    start(ctx: AsrContext) {
      const Ctor: SRCtor | undefined =
        (globalThis as any).SpeechRecognition ??
        (globalThis as any).webkitSpeechRecognition;
      if (!Ctor) {
        ctx.error("Speech engine unavailable in this Chrome.");
        return;
      }
      active = true;
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = ctx.settings.language || "en-US";

      recognition.onresult = (e) => {
        let partial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) ctx.emit({ kind: "final", text: r[0].transcript + " " });
          else partial += r[0].transcript;
        }
        if (partial) ctx.emit({ kind: "partial", text: partial });
      };

      recognition.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          active = false;
          ctx.error("mic-denied");
        }
        // "no-speech" / "aborted" are routine; onend handles the rest
      };

      // The speech service times out on silence; keep the session alive
      // until stop() is called.
      recognition.onend = () => {
        if (!active || !recognition) return;
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      };

      recognition.start();
    },

    stop() {
      active = false;
      if (recognition) {
        recognition.onend = null;
        try {
          recognition.stop();
        } catch {
          /* already stopped */
        }
        recognition = null;
      }
    },
  };
}
