// Speech engines behind one interface, so the offscreen document and the
// pop-out can swap recognition backends without knowing the details.
//
//   const engine = Engines.create(kind, cfg, callbacks)
//   engine.start(stream, audioCtx)   // stream/audioCtx may be ignored (chrome)
//   engine.stop()
//
// kinds:
//   "chrome"     — Chrome's built-in Web Speech API (default, free)
//   "cf-whisper" — Cloudflare Workers AI @cf/openai/whisper-large-v3-turbo (batch REST)
//   "cf-flux"    — Cloudflare Workers AI @cf/deepgram/flux (streaming WebSocket via AI Gateway)
//
// callbacks:
//   onTentative(text)  — in-progress text for the current phrase ("" to clear)
//   onSegment(text)    — a finalized phrase to append
//   onDone(fullOrNull) — session over; string = full-session transcript (batch),
//                        null = use the segments you accumulated
//   onError(message)   — human-readable failure
//
// cfg: { language, autoRestart, accountId, apiToken, gateway }

(function (root) {
  "use strict";

  var WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
  var FLUX_MODEL = "@cf/deepgram/flux";
  var TARGET_RATE = 16000;
  var MAX_BATCH_SECONDS = 300; // cap Whisper uploads at 5 minutes of audio

  // ---------- PCM utilities (pure; exported for tests) ----------

  // Float32 samples at fromRate -> Int16Array at 16 kHz (linear interpolation).
  function downsampleTo16k(input, fromRate) {
    var ratio = fromRate / TARGET_RATE;
    var outLen = Math.max(1, Math.floor(input.length / ratio));
    var out = new Int16Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var pos = i * ratio;
      var i0 = Math.floor(pos);
      var i1 = Math.min(i0 + 1, input.length - 1);
      var frac = pos - i0;
      var s = input[i0] * (1 - frac) + input[i1] * frac;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  // Mono 16-bit 16 kHz PCM -> WAV file bytes.
  function encodeWav16k(samples) {
    var dataLen = samples.length * 2;
    var buf = new ArrayBuffer(44 + dataLen);
    var v = new DataView(buf);
    function str(off, s) {
      for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    }
    str(0, "RIFF");
    v.setUint32(4, 36 + dataLen, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true); // fmt chunk size
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, TARGET_RATE, true);
    v.setUint32(28, TARGET_RATE * 2, true); // byte rate
    v.setUint16(32, 2, true); // block align
    v.setUint16(34, 16, true); // bits per sample
    str(36, "data");
    v.setUint32(40, dataLen, true);
    new Int16Array(buf, 44).set(samples);
    return new Uint8Array(buf);
  }

  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  // Feed 16 kHz Int16 chunks from a mic stream. Returns an untap function.
  function createPcmTap(audioCtx, stream, onChunk) {
    var src = audioCtx.createMediaStreamSource(stream);
    var proc = audioCtx.createScriptProcessor(4096, 1, 1);
    var mute = audioCtx.createGain();
    mute.gain.value = 0; // ScriptProcessor must reach destination; keep it silent
    proc.onaudioprocess = function (e) {
      onChunk(downsampleTo16k(e.inputBuffer.getChannelData(0), audioCtx.sampleRate));
    };
    src.connect(proc);
    proc.connect(mute);
    mute.connect(audioCtx.destination);
    return function () {
      proc.onaudioprocess = null;
      try { src.disconnect(); } catch (_) {}
      try { proc.disconnect(); } catch (_) {}
      try { mute.disconnect(); } catch (_) {}
    };
  }

  function needCreds(cfg, needGateway) {
    if (!cfg.accountId || !cfg.apiToken) {
      return "Add your Cloudflare Account ID and API token in Settings.";
    }
    if (needGateway && !cfg.gateway) {
      return "Deepgram Flux needs an AI Gateway name — add it in Settings.";
    }
    return null;
  }

  // ---------- Chrome built-in (Web Speech API) ----------
  function createChromeEngine(cfg, cb) {
    var recognition = null;
    var active = false;

    function start() {
      var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!SR) {
        cb.onError("Speech engine unavailable in this Chrome.");
        return;
      }
      active = true;
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = cfg.language || "en-US";

      recognition.onresult = function (e) {
        var tentative = "";
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) cb.onSegment(r[0].transcript + " ");
          else tentative += r[0].transcript;
        }
        cb.onTentative(tentative);
      };
      recognition.onerror = function (e) {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          active = false;
          cb.onError("mic-denied");
        }
        // "no-speech" / "aborted" are routine
      };
      recognition.onend = function () {
        if (!active) return;
        if (cfg.autoRestart) {
          try { recognition.start(); } catch (_) {}
        } else {
          active = false;
          cb.onDone(null);
        }
      };
      recognition.start();
    }

    function stop() {
      if (!active) return;
      active = false;
      if (recognition) {
        recognition.onend = null;
        try { recognition.stop(); } catch (_) {}
        recognition = null;
      }
      cb.onDone(null);
    }

    return { start: start, stop: stop };
  }

  // ---------- Cloudflare Whisper large-v3-turbo (batch REST) ----------
  function createWhisperEngine(cfg, cb) {
    var untap = null;
    var chunks = [];
    var totalSamples = 0;
    var capped = false;

    function start(stream, audioCtx) {
      var err = needCreds(cfg, false);
      if (err) { cb.onError(err); return; }
      untap = createPcmTap(audioCtx, stream, function (int16) {
        if (totalSamples >= TARGET_RATE * MAX_BATCH_SECONDS) {
          capped = true;
          return;
        }
        chunks.push(int16);
        totalSamples += int16.length;
      });
    }

    async function stop() {
      if (untap) { untap(); untap = null; }
      if (totalSamples === 0) { cb.onDone(""); return; }

      var all = new Int16Array(totalSamples);
      var off = 0;
      for (var i = 0; i < chunks.length; i++) {
        all.set(chunks[i], off);
        off += chunks[i].length;
      }
      chunks = [];

      var body = { audio: bytesToBase64(encodeWav16k(all)), task: "transcribe" };
      if (cfg.language) body.language = String(cfg.language).split("-")[0];

      var url =
        "https://api.cloudflare.com/client/v4/accounts/" +
        encodeURIComponent(cfg.accountId) +
        "/ai/run/" + WHISPER_MODEL;
      try {
        var resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + cfg.apiToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (resp.status === 401 || resp.status === 403) {
          cb.onError("Cloudflare rejected the API token — check it in Settings.");
          return;
        }
        if (resp.status === 404) {
          cb.onError("Cloudflare Account ID not found — check it in Settings.");
          return;
        }
        var json = await resp.json();
        if (!json.success) {
          var msg = (json.errors && json.errors[0] && json.errors[0].message) || "unknown error";
          cb.onError("Whisper request failed: " + msg);
          return;
        }
        var text = (json.result && json.result.text) || "";
        cb.onDone(text + (capped ? " [recording capped at 5 minutes]" : ""));
      } catch (_) {
        cb.onError("Couldn't reach Cloudflare — check your connection.");
      }
    }

    return { start: start, stop: stop };
  }

  // ---------- Cloudflare Deepgram Flux (streaming WebSocket via AI Gateway) ----------
  function createFluxEngine(cfg, cb) {
    var ws = null;
    var untap = null;
    var stopping = false;
    var finished = false;
    var lastTentative = "";
    var closeTimer = null;

    function finish() {
      if (finished) return;
      finished = true;
      if (closeTimer) clearTimeout(closeTimer);
      // Commit any phrase Flux never closed out.
      if (lastTentative.trim()) cb.onSegment(lastTentative.trim() + " ");
      lastTentative = "";
      cb.onDone(null);
    }

    function start(stream, audioCtx) {
      var err = needCreds(cfg, true);
      if (err) { cb.onError(err); return; }

      var url =
        "wss://gateway.ai.cloudflare.com/v1/" +
        encodeURIComponent(cfg.accountId) + "/" +
        encodeURIComponent(cfg.gateway) +
        "/workers-ai?model=" + encodeURIComponent(FLUX_MODEL) +
        "&encoding=linear16&sample_rate=16000";

      // Browsers can't set headers on WebSockets; AI Gateway accepts the token
      // as a subprotocol: "cf-aig-authorization.<token>".
      try {
        ws = new WebSocket(url, ["cf-aig-authorization." + cfg.apiToken]);
      } catch (_) {
        cb.onError("Couldn't open the Flux connection — check the gateway name.");
        return;
      }
      ws.binaryType = "arraybuffer";

      ws.onopen = function () {
        untap = createPcmTap(audioCtx, stream, function (int16) {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(int16.buffer);
        });
      };

      ws.onmessage = function (e) {
        if (typeof e.data !== "string") return;
        var msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg.type !== "TurnInfo") return;
        var transcript = msg.transcript || "";
        if (msg.event === "Update" || msg.event === "EagerEndOfTurn" || msg.event === "TurnResumed") {
          lastTentative = transcript;
          cb.onTentative(transcript);
        } else if (msg.event === "EndOfTurn") {
          lastTentative = "";
          cb.onTentative("");
          if (transcript.trim()) cb.onSegment(transcript.trim() + " ");
        }
      };

      ws.onerror = function () {
        if (stopping) return;
        cb.onError(
          "Flux connection failed — check the AI Gateway name, Account ID, and token."
        );
      };

      ws.onclose = function (e) {
        if (untap) { untap(); untap = null; }
        if (stopping) { finish(); return; }
        if (!finished) {
          cb.onError(
            e.code === 1006
              ? "Flux connection rejected — verify the gateway exists and the token has Workers AI access."
              : "Flux connection closed (" + e.code + ")."
          );
          finished = true;
        }
      };
    }

    function stop() {
      stopping = true;
      if (untap) { untap(); untap = null; }
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch (_) {}
        // Give the server a beat to flush the last EndOfTurn, then force it.
        closeTimer = setTimeout(function () {
          try { ws.close(); } catch (_) {}
          finish();
        }, 1600);
      } else {
        finish();
      }
    }

    return { start: start, stop: stop };
  }

  // ---------- factory ----------
  function create(kind, cfg, cb) {
    cfg = cfg || {};
    if (kind === "cf-whisper") return createWhisperEngine(cfg, cb);
    if (kind === "cf-flux") return createFluxEngine(cfg, cb);
    return createChromeEngine(cfg, cb);
  }

  // "cf-whisper" has no live text; callers can adapt their UI.
  function isBatch(kind) {
    return kind === "cf-whisper";
  }

  root.Engines = {
    create: create,
    isBatch: isBatch,
    downsampleTo16k: downsampleTo16k,
    encodeWav16k: encodeWav16k,
    bytesToBase64: bytesToBase64,
  };
})(typeof self !== "undefined" ? self : this);
