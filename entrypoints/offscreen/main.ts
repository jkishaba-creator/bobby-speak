// Extension layer: offscreen document — the pipeline's home. Translates
// between runtime messages (the transport at context boundaries) and the
// typed DictationSession inside.

import { startDictation, type DictationSession } from "../../src/pipeline";
import type { OffscreenMessage, Settings } from "../../src/shared/types";

let session: DictationSession | null = null;
let feedbackOn = false;

// Audible start/stop cues for dictation begun from another app, where no
// Bobby Speak UI is visible. Two soft tones, entirely generated — no assets.
function tone(freq: number, startAt: number, duration = 0.09) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + duration + 0.02);
  osc.onended = () => void ctx.close().catch(() => {});
}

function beepStart() {
  tone(660, 0);
  tone(990, 0.1);
}

function beepDone() {
  tone(990, 0);
  tone(660, 0.1);
}

function send(payload: Record<string, unknown>) {
  chrome.runtime
    .sendMessage({ target: "background", ...payload })
    .catch(() => {});
}

function start(settings: Settings, feedback = false) {
  if (session) return;
  feedbackOn = feedback;
  if (feedback) beepStart();
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
        if (feedbackOn) beepDone();
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
  if (msg.type === "start") start(msg.settings, msg.feedback === true);
  if (msg.type === "stop") void session?.stop();
  if (msg.type === "copy") copyText(msg.text);
});
