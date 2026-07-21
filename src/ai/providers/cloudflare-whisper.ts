// Cloudflare Workers AI @cf/openai/whisper-large-v3-turbo — batch REST.
// Accumulates the pipeline's 16 kHz frames, uploads one WAV on stop.
// Transport (HTTP) is an implementation detail that never leaves this file.

import { bytesToBase64, encodeWav16k, TARGET_RATE } from "../../audio/resample";
import { runCloudflareModel } from "../cloudflareClient";
import type { AsrContext, AsrProvider } from "../provider";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_SECONDS = 300;

export function cloudflareWhisperProvider(): AsrProvider {
  let chunks: Int16Array[] = [];
  let total = 0;
  let capped = false;
  let unsubscribe: (() => void) | null = null;
  let context: AsrContext | null = null;

  return {
    id: "cf-whisper",
    label: "Whisper large-v3-turbo (Cloudflare)",
    streaming: false,

    start(ctx: AsrContext) {
      const { cfAccountId, cfApiToken } = ctx.settings;
      if (!cfAccountId || !cfApiToken) {
        ctx.error("Add your Cloudflare Account ID and API token in Settings.");
        return;
      }
      context = ctx;
      chunks = [];
      total = 0;
      capped = false;
      unsubscribe = ctx.audio.subscribe((frame) => {
        if (total >= TARGET_RATE * MAX_SECONDS) {
          capped = true;
          return;
        }
        chunks.push(frame.samples);
        total += frame.samples.length;
      });
    },

    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      const ctx = context;
      context = null;
      if (!ctx || total === 0) return;

      const all = new Int16Array(total);
      let off = 0;
      for (const c of chunks) {
        all.set(c, off);
        off += c.length;
      }
      chunks = [];

      const body: Record<string, unknown> = {
        audio: bytesToBase64(encodeWav16k(all)),
        task: "transcribe",
      };
      if (ctx.settings.language) {
        body.language = ctx.settings.language.split("-")[0];
      }

      try {
        const resp = await runCloudflareModel(
          MODEL,
          {
            accountId: ctx.settings.cfAccountId,
            apiToken: ctx.settings.cfApiToken,
          },
          body,
        );
        if (resp.status === 401 || resp.status === 403) {
          ctx.error("Cloudflare rejected the API token — check it in Settings.");
          return;
        }
        if (resp.status === 404) {
          ctx.error("Cloudflare Account ID not found — check it in Settings.");
          return;
        }
        const json = await resp.json();
        if (!json.success) {
          ctx.error(
            "Whisper request failed: " +
              (json.errors?.[0]?.message ?? "unknown error"),
          );
          return;
        }
        const text: string = json.result?.text ?? "";
        ctx.emit({
          kind: "final",
          text: text + (capped ? " [recording capped at 5 minutes]" : ""),
        });
      } catch {
        ctx.error("Couldn't reach Cloudflare — check your connection.");
      }
    },
  };
}
