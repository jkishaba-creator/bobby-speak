// Offscreen document: microphone capture + speech engine + level meter.
//
// Engine note: v0.1 uses Chrome's built-in SpeechRecognition (Web Speech API)
// so the extension works with zero downloads. The seam for the local-Whisper
// engine from the conversion plan is `startEngine`/`stopEngine` — swap those
// for a transformers.js/WebGPU implementation without touching anything else.

let recognition = null;
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

function startEngine(language) {
  const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
  if (!SR) {
    send("engine-error", { message: "Speech engine unavailable in this Chrome." });
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language || "en-US";

  recognition.onresult = (e) => {
    let tentative = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) committed += result[0].transcript;
      else tentative += result[0].transcript;
    }
    send("interim", { committed, tentative });
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      active = false;
      cleanup();
      send("mic-denied");
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      send("engine-error", { message: "Speech error: " + e.error });
    }
  };

  // Fires on natural silence timeout AND after stop(); single finish path.
  recognition.onend = () => {
    if (!active) return;
    active = false;
    cleanup();
    send("final", { transcript: committed });
  };

  recognition.start();
}

function stopEngine() {
  if (recognition) {
    try {
      recognition.stop(); // triggers onend -> final
      return;
    } catch (_) {
      /* fall through to manual finish */
    }
  }
  if (active) {
    active = false;
    cleanup();
    send("final", { transcript: committed });
  }
}

async function start(language) {
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
  startEngine(language);
}

function cleanup() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  recognition = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "start") start(msg.language);
  if (msg.type === "stop") stopEngine();
});
