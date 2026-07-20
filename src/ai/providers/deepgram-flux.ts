// Deepgram Flux on Cloudflare Workers AI — streaming WebSocket through AI
// Gateway. Browsers can't set WebSocket auth headers, so the token rides the
// cf-aig-authorization subprotocol. Transport details stay in this file.

import type { AsrContext, AsrProvider } from "../provider";

const MODEL = "@cf/deepgram/flux";

export function deepgramFluxProvider(): AsrProvider {
  let ws: WebSocket | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopping = false;
  let finished = false;
  let lastPartial = "";
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let context: AsrContext | null = null;
  let resolveStop: (() => void) | null = null;

  function finish() {
    if (finished) return;
    finished = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (lastPartial.trim() && context) {
      context.emit({ kind: "final", text: lastPartial.trim() + " " });
    }
    lastPartial = "";
    resolveStop?.();
  }

  return {
    id: "cf-flux",
    label: "Deepgram Flux (Cloudflare, streaming)",
    streaming: true,

    start(ctx: AsrContext) {
      const { cfAccountId, cfApiToken, cfGateway } = ctx.settings;
      if (!cfAccountId || !cfApiToken) {
        ctx.error("Add your Cloudflare Account ID and API token in Settings.");
        return;
      }
      if (!cfGateway) {
        ctx.error("Deepgram Flux needs an AI Gateway name — add it in Settings.");
        return;
      }
      context = ctx;
      stopping = false;
      finished = false;

      const url =
        "wss://gateway.ai.cloudflare.com/v1/" +
        encodeURIComponent(cfAccountId) +
        "/" +
        encodeURIComponent(cfGateway) +
        "/workers-ai?model=" +
        encodeURIComponent(MODEL) +
        "&encoding=linear16&sample_rate=16000";

      try {
        ws = new WebSocket(url, ["cf-aig-authorization." + cfApiToken]);
      } catch {
        ctx.error("Couldn't open the Flux connection — check the gateway name.");
        return;
      }
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        unsubscribe = ctx.audio.subscribe((frame) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(frame.samples.buffer as ArrayBuffer);
          }
        });
      };

      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type !== "TurnInfo") return;
        const transcript: string = msg.transcript ?? "";
        if (
          msg.event === "Update" ||
          msg.event === "EagerEndOfTurn" ||
          msg.event === "TurnResumed"
        ) {
          lastPartial = transcript;
          ctx.emit({ kind: "partial", text: transcript });
        } else if (msg.event === "EndOfTurn") {
          lastPartial = "";
          if (transcript.trim()) {
            ctx.emit({ kind: "final", text: transcript.trim() + " " });
          }
        }
      };

      ws.onerror = () => {
        if (!stopping) {
          ctx.error(
            "Flux connection failed — check the AI Gateway name, Account ID, and token.",
          );
        }
      };

      ws.onclose = (e) => {
        unsubscribe?.();
        unsubscribe = null;
        if (stopping) {
          finish();
          return;
        }
        if (!finished) {
          finished = true;
          ctx.error(
            e.code === 1006
              ? "Flux connection rejected — verify the gateway exists and the token has Workers AI access."
              : "Flux connection closed (" + e.code + ").",
          );
        }
      };
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        resolveStop = resolve;
        stopping = true;
        unsubscribe?.();
        unsubscribe = null;
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          } catch {
            /* closing anyway */
          }
          // Give the server a beat to flush the last EndOfTurn, then force it.
          closeTimer = setTimeout(() => {
            try {
              ws?.close();
            } catch {
              /* already closed */
            }
            finish();
          }, 1600);
        } else {
          finish();
        }
      });
    },
  };
}
