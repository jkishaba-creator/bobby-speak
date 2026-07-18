// Pop-out window: self-contained dictation surface for use with OTHER apps.
// Runs the mic + selected speech engine (lib/engines.js) directly in this
// visible window and keeps the system clipboard preloaded with the cleaned
// transcript as you speak — dictate here, ⌘V / Ctrl+V into anything.

(() => {
  "use strict";

  const hasChrome =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  const els = {
    orbBtn: document.getElementById("orbBtn"),
    toggleBtn: document.getElementById("toggleBtn"),
    copyBtn: document.getElementById("copyBtn"),
    clearBtn: document.getElementById("clearBtn"),
    statusTitle: document.getElementById("statusTitle"),
    statusSub: document.getElementById("statusSub"),
    text: document.getElementById("text"),
    tentative: document.getElementById("tentative"),
    clip: document.getElementById("clip"),
    bars: Array.from(document.querySelectorAll(".wave i")),
  };

  let settings = {
    engine: "chrome",
    language: "en-US",
    removeFillers: true,
    spokenPunctuation: true,
    aiPolish: true,
    customWords: [],
    cfAccountId: "",
    cfApiToken: "",
    cfGateway: "",
  };

  let listening = false;
  let engine = null;
  let stream = null;
  let audioCtx = null;
  let rafId = null;
  let committed = ""; // raw engine text for this session
  let pendingCopy = null;

  // ---------- settings ----------
  async function loadSettings() {
    if (!hasChrome) return;
    const data = await chrome.storage.local.get("settings");
    settings = Object.assign(settings, data.settings || {});
  }

  function engineCfg(autoRestart) {
    return {
      language: settings.language,
      autoRestart,
      accountId: settings.cfAccountId,
      apiToken: settings.cfApiToken,
      gateway: settings.cfGateway,
    };
  }

  // ---------- cleanup pipeline ----------
  function cleanNow(raw) {
    return TextCleanup.clean(raw, settings);
  }

  // ---------- clipboard ----------
  async function copyToClipboard(text, { silentIfEmpty = true } = {}) {
    if (!text) {
      if (!silentIfEmpty) setClip("Nothing to copy", "err");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pendingCopy = null;
      const isMac = navigator.platform.toLowerCase().includes("mac");
      setClip("On clipboard — " + (isMac ? "⌘V" : "Ctrl+V") + " anywhere", "ok");
    } catch (_) {
      // clipboard needs window focus; retry when we get it back
      pendingCopy = text;
      setClip("Refocus this window to copy", "err");
    }
  }

  window.addEventListener("focus", () => {
    if (pendingCopy) copyToClipboard(pendingCopy);
  });

  function setClip(message, cls) {
    els.clip.textContent = message;
    els.clip.className = "clip" + (cls ? " " + cls : "");
  }

  // ---------- transcript ----------
  function renderTranscript(finalize) {
    const cleaned = cleanNow(committed);
    els.text.value = cleaned;
    els.text.scrollTop = els.text.scrollHeight;
    if (finalize) copyToClipboard(cleaned);
  }

  // manual edits re-copy after a beat
  let editTimer = null;
  els.text.addEventListener("input", () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => copyToClipboard(els.text.value), 600);
  });

  // ---------- level meter ----------
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
      if (t - last < 70) return;
      last = t;
      analyser.getByteFrequencyData(data);
      els.bars.forEach((bar, b) => {
        let sum = 0;
        for (let i = 0; i < 8; i++) sum += data[b * 8 + i] || 0;
        const v = Math.min(1, sum / (8 * 170));
        bar.style.height = Math.max(4, Math.round(v * 16)) + "px";
      });
    };
    rafId = requestAnimationFrame(loop);
  }

  function resetBars() {
    els.bars.forEach((bar) => (bar.style.height = "4px"));
  }

  // ---------- session ----------
  async function startListening() {
    if (listening) return;
    await loadSettings();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      setStatus(
        "Microphone blocked",
        "Allow the mic for this window (icon in the address bar), then try again."
      );
      return;
    }
    audioCtx = new AudioContext();
    startLevelMeter();

    engine = Engines.create(settings.engine, engineCfg(settings.engine === "chrome"), {
      onTentative: (t) => {
        els.tentative.textContent = t ? "… " + t : "";
      },
      onSegment: (segment) => {
        committed += segment;
        renderTranscript(true); // clean + auto-copy on every finalized phrase
      },
      onDone: (full) => handleDone(full),
      onError: (message) => {
        stopMedia();
        listening = false;
        document.body.classList.remove("listening");
        els.toggleBtn.textContent = "Start";
        if (message === "mic-denied") {
          setStatus(
            "Microphone blocked",
            "Allow the mic for this window (icon in the address bar), then try again."
          );
        } else {
          setStatus("Engine error", message);
        }
      },
    });

    listening = true;
    document.body.classList.add("listening");
    els.toggleBtn.textContent = "Stop";
    if (Engines.isBatch(settings.engine)) {
      setStatus("Listening…", "Whisper transcribes when you stop (no live text)");
    } else {
      setStatus("Listening…", "Pause any time — the session survives silences");
    }
    engine.start(stream, audioCtx);
  }

  function stopListening() {
    if (!listening || !engine) return;
    listening = false;
    document.body.classList.remove("listening");
    els.toggleBtn.textContent = "Start";
    els.tentative.textContent = "";
    if (Engines.isBatch(settings.engine)) {
      setStatus("Transcribing…", "Sending audio to Whisper on your Cloudflare account");
      setClip("Transcribing…");
    }
    engine.stop(); // engine calls onDone (async for Whisper)
  }

  async function handleDone(full) {
    stopMedia();
    engine = null;
    setStatus("Click the orb, then talk", "Your words are kept on the clipboard as you go");

    if (full != null && full.trim()) {
      committed = full + " ";
    }
    // Final pass: optional on-device AI polish, silently skipped if unavailable.
    let finalText = cleanNow(committed) || els.text.value;
    if (finalText && settings.aiPolish !== false && typeof GrammarPolish !== "undefined") {
      setClip("Polishing…");
      const polished = await GrammarPolish.polish(finalText);
      if (polished) finalText = polished;
    }
    if (finalText) {
      els.text.value = finalText;
      copyToClipboard(finalText);
    } else {
      setClip("Clipboard idle");
    }
  }

  function stopMedia() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    resetBars();
    if (audioCtx) audioCtx.close().catch(() => {});
    audioCtx = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function toggle() {
    if (listening) stopListening();
    else startListening();
  }

  function setStatus(title, sub) {
    els.statusTitle.textContent = title;
    els.statusSub.textContent = sub;
  }

  // ---------- buttons ----------
  els.orbBtn.addEventListener("click", toggle);
  els.toggleBtn.addEventListener("click", toggle);
  els.copyBtn.addEventListener("click", () =>
    copyToClipboard(els.text.value, { silentIfEmpty: false })
  );
  els.clearBtn.addEventListener("click", () => {
    committed = "";
    els.text.value = "";
    els.tentative.textContent = "";
    setClip("Clipboard idle");
    els.text.focus();
  });

  // Space toggles when the textarea isn't focused
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== els.text) {
      e.preventDefault();
      toggle();
    }
  });

  loadSettings();
})();
