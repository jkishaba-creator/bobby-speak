// Extension layer: offscreen document — the pipeline's home. Translates
// between runtime messages (the transport at context boundaries) and the
// typed DictationSession inside.

import { startDictation, type DictationSession } from "../../src/pipeline";
import type { OffscreenMessage, Settings } from "../../src/shared/types";

let session: DictationSession | null = null;

function send(payload: Record<string, unknown>) {
  chrome.runtime
    .sendMessage({ target: "background", ...payload })
    .catch(() => {});
}

function start(settings: Settings) {
  if (session) return;
  // Not awaited: startDictation is synchronous precisely so this subscribe
  // happens before any event (including mic-denied) can be emitted.
  session = startDictation(settings);
  session.events.subscribe((event) => {
    switch (event.type) {
      case "level":
        send({ type: "level", levels: event.levels });
        break;
      case "text":
        send({
          type: "overlay-text",
          committed: event.committed,
          tentative: event.tentative,
        });
        break;
      case "done":
        session = null;
        send({ type: "done", transcript: event.transcript });
        break;
      case "mic-denied":
        session = null;
        send({ type: "mic-denied" });
        break;
      case "error":
        session = null;
        send({ type: "engine-error", message: event.message });
        break;
    }
  });
}

// Clipboard writes need a DOM; the service worker has none, so it asks us.
function copyText(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

chrome.runtime.onMessage.addListener((msg: OffscreenMessage) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "start") start(msg.settings);
  if (msg.type === "stop") void session?.stop();
  if (msg.type === "copy") copyText(msg.text);
});
