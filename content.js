// Content script: the overlay pill + text insertion at the cursor.
// The overlay lives in a closed shadow root so page CSS can't touch it.

(() => {
  "use strict";

  // The manifest injects this into new pages, and background.js injects it
  // on demand into tabs that were open before install. Never run twice.
  if (window.__bobbySpeakLoaded) return;
  window.__bobbySpeakLoaded = true;

  // ---------- focus tracking ----------
  let lastEditable = null;

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const texty = ["text", "search", "email", "url", "tel", "number", ""];
      return texty.includes(type) && !el.disabled && !el.readOnly;
    }
    return el.isContentEditable;
  }

  document.addEventListener(
    "focusin",
    (e) => {
      if (isEditable(e.target)) lastEditable = e.target;
    },
    true
  );

  // ---------- insertion ----------
  function insertText(text) {
    let el =
      document.activeElement && isEditable(document.activeElement)
        ? document.activeElement
        : lastEditable;
    if (el && document.contains(el)) {
      el.focus();
      // execCommand is deprecated but still the only insertion path that is
      // undo-friendly and fires the right events in both inputs and
      // contenteditable across real-world sites.
      if (document.execCommand("insertText", false, text)) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        insertIntoField(el, text);
        return;
      }
    }
    // No editable target (or a canvas editor like Google Docs):
    // clipboard fallback with a visible hint.
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("Copied — press " + pasteKey() + " to paste"))
      .catch(() => showToast("Couldn't find a text field to type into"));
  }

  // React-controlled fields ignore .value writes; go through the native
  // setter and fire an InputEvent so the framework sees the change.
  function insertIntoField(el, text) {
    const proto =
      el.tagName === "INPUT"
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })
    );
    const pos = start + text.length;
    try {
      el.setSelectionRange(pos, pos);
    } catch (_) {
      /* number inputs don't support selection */
    }
  }

  function pasteKey() {
    return navigator.platform.toLowerCase().includes("mac") ? "⌘V" : "Ctrl+V";
  }

  // ---------- overlay pill ----------
  let host = null;
  let ui = null;

  function ensureOverlay() {
    if (host) return ui;
    host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:0;right:0;bottom:26px;display:flex;justify-content:center;" +
      "z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .pill {
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Arial, sans-serif;
          background: #17171B; color: #F7F7FA;
          border-radius: 999px; padding: 10px 18px;
          display: flex; align-items: center; gap: 12px;
          box-shadow: 0 10px 30px -8px rgba(10,10,16,.5);
          font-size: 13px; max-width: min(560px, 86vw);
          opacity: 0; transform: translateY(10px);
          transition: opacity .18s ease, transform .18s ease;
        }
        .pill.visible { opacity: 1; transform: translateY(0); }
        .wave { display: flex; align-items: center; gap: 2.5px; height: 18px; flex-shrink: 0; }
        .wave i { display: block; width: 2.5px; height: 4px; border-radius: 2px; background: #45D2BD; transition: height .1s ease; }
        .label { font-weight: 650; letter-spacing: .01em; flex-shrink: 0; }
        .preview { color: #B9BCC6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
        .preview b { color: #F7F7FA; font-weight: 500; }
        .spinner { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid rgba(247,247,250,.25); border-top-color: #45D2BD;
          animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } }
        .err { color: #FFB3A6; }
        .hidden { display: none; }
      </style>
      <div class="pill" part="pill">
        <span class="wave">${"<i></i>".repeat(9)}</span>
        <span class="spinner hidden"></span>
        <span class="label">Listening</span>
        <span class="preview"></span>
      </div>`;
    document.documentElement.appendChild(host);
    ui = {
      pill: root.querySelector(".pill"),
      wave: root.querySelector(".wave"),
      bars: Array.from(root.querySelectorAll(".wave i")),
      spinner: root.querySelector(".spinner"),
      label: root.querySelector(".label"),
      preview: root.querySelector(".preview"),
    };
    return ui;
  }

  function showOverlay() {
    const u = ensureOverlay();
    u.wave.classList.remove("hidden");
    u.spinner.classList.add("hidden");
    u.label.textContent = "Listening";
    u.label.classList.remove("err");
    u.preview.textContent = "";
    requestAnimationFrame(() => u.pill.classList.add("visible"));
  }

  function showProcessing() {
    const u = ensureOverlay();
    u.wave.classList.add("hidden");
    u.spinner.classList.remove("hidden");
    u.label.textContent = "Processing";
    u.pill.classList.add("visible");
  }

  function showError(message) {
    const u = ensureOverlay();
    u.wave.classList.add("hidden");
    u.spinner.classList.add("hidden");
    u.label.textContent = message;
    u.label.classList.add("err");
    u.preview.textContent = "";
    u.pill.classList.add("visible");
  }

  function hideOverlay() {
    if (!ui) return;
    ui.pill.classList.remove("visible");
  }

  function setLevels(levels) {
    if (!ui || !levels) return;
    ui.bars.forEach((bar, i) => {
      const v = levels[i] || 0;
      bar.style.height = Math.max(4, Math.round(v * 18)) + "px";
    });
  }

  function setText(committedText, tentativeText) {
    if (!ui) return;
    const total = (committedText || "") + (tentativeText || "");
    if (!total) {
      ui.preview.textContent = "";
      return;
    }
    ui.preview.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = committedText || "";
    ui.preview.appendChild(b);
    ui.preview.appendChild(document.createTextNode(tentativeText || ""));
  }

  function showToast(message) {
    showError(message);
    setTimeout(hideOverlay, 2200);
  }

  // ---------- message handling ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    switch (msg.type) {
      case "ping":
        sendResponse({ ok: true });
        return;
      case "overlay-show":
        showOverlay();
        break;
      case "overlay-processing":
        showProcessing();
        break;
      case "overlay-level":
        setLevels(msg.levels);
        break;
      case "overlay-text":
        setText(msg.committed, msg.tentative);
        break;
      case "overlay-error":
        showError(msg.message);
        break;
      case "overlay-hide":
        hideOverlay();
        break;
      case "insert-text":
        insertText(msg.text);
        break;
    }
  });
})();
