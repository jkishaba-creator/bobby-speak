// Offscreen document: owns the microphone stream and the level meter, and
// delegates recognition to the selected engine (lib/engines.js):
// Chrome built-in, Cloudflare Whisper large-v3-turbo, or Deepgram Flux.

let engine = null;
let stream = null;
let audioCtx = null;
let rafId = null;
let committed = "";
let active = false;

function send(type, payload = {}) {
  chrome.runtime
    .sendMessage(Object.assign({ target: "background", type }, payload))
    .catch(() => {});
}

function startLevelMeter() {
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let last = 0;

  const loop = (t) => {
    rafId = requestAnimationFrame(loop);
    if (t - last < 80) return; // ~12 fps is plenty for the overlay bars
    last = t;
    analyser.getByteFrequencyData(data);
    const levels = [];
    for (let b = 0; b < 9; b++) {
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += data[b * 8 + i] || 0;
      levels.push(Math.min(1, sum / (8 * 170)));
    }
    send("level", { levels });
  };
  rafId = requestAnimationFrame(loop);
}

async function start(settings) {
  if (active) return;
  committed = "";
  active = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    active = false;
    send("mic-denied");
    return;
  }
  audioCtx = new AudioContext();
  startLevelMeter();

  engine = Engines.create(settings.engine, {
    language: settings.language,
    autoRestart: false,
    accountId: settings.cfAccountId,
    apiToken: settings.cfApiToken,
    gateway: settings.cfGateway,
  }, {
    onTentative: (tentative) => send("interim", { committed, tentative }),
    onSegment: (segment) => {
      committed += segment;
      send("interim", { committed, tentative: "" });
    },
    onDone: (full) => {
      if (!active) return;
      active = false;
      cleanup();
      send("final", { transcript: full != null ? full : committed });
    },
    onError: (message) => {
      const wasActive = active;
      active = false;
      cleanup();
      if (!wasActive) return;
      if (message === "mic-denied") send("mic-denied");
      else send("engine-error", { message });
    },
  });
  engine.start(stream, audioCtx);
}

function stop() {
  if (!engine) {
    if (active) {
      active = false;
      cleanup();
      send("final", { transcript: committed });
    }
    return;
  }
  engine.stop(); // engine calls onDone (possibly async, e.g. Whisper upload)
}

function cleanup() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  engine = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "start") start(msg.settings || { language: msg.language });
  if (msg.type === "stop") stop();
});
