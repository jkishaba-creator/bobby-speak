// Pop-out window: self-contained dictation surface for use with OTHER apps.
// Runs mic + speech engine directly in this (visible, focused) window and
// keeps the system clipboard preloaded with the cleaned transcript as you
// speak — dictate here, ⌘V / Ctrl+V into anything, including native apps.
//
// The engine auto-restarts on the speech service's silence timeout so long
// dictations survive pauses; only the orb/Stop ends a session.

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
    language: "en-US",
    removeFillers: true,
    spokenPunctuation: true,
    aiPolish: true,
    customWords: [],
  };

  let listening = false;
  let recognition = null;
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

  // ---------- speech engine ----------
  function makeRecognition() {
    const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
    if (!SR) {
      setStatus("Speech engine unavailable", "This Chrome build has no speech service.");
      return null;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = settings.language || "en-US";

    rec.onresult = (e) => {
      let tentative = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          committed += r[0].transcript + " ";
          renderTranscript(true); // clean + auto-copy on every finalized chunk
        } else {
          tentative += r[0].transcript;
        }
      }
      els.tentative.textContent = tentative ? "… " + tentative : "";
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopListening(false);
        setStatus(
          "Microphone blocked",
          "Allow the mic for this window (icon in the address bar), then try again."
        );
      }
      // "no-speech"/"aborted" are routine; onend handles restarts
    };

    // Speech services time out on silence; keep the session alive.
    rec.onend = () => {
      if (listening) {
        try {
          rec.start();
        } catch (_) {
          /* already starting */
        }
      }
    };
    return rec;
  }

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
    recognition = makeRecognition();
    if (!recognition) return;
    listening = true;
    document.body.classList.add("listening");
    els.toggleBtn.textContent = "Stop";
    setStatus("Listening…", "Pause any time — the session survives silences");
    recognition.start();
  }

  async function stopListening(finalize = true) {
    listening = false;
    document.body.classList.remove("listening");
    els.toggleBtn.textContent = "Start";
    els.tentative.textContent = "";
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch (_) {}
      recognition = null;
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    resetBars();
    if (audioCtx) audioCtx.close().catch(() => {});
    audioCtx = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;

    if (!finalize) return;
    setStatus("Click the orb, then talk", "Your words are kept on the clipboard as you go");

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
    }
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
