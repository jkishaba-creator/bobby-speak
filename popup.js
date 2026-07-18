// Popup: quick status + start/stop. Talks only to the service worker.
// Guarded so the page still renders when previewed outside Chrome.

(() => {
  "use strict";

  const hasChrome =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  const orbBtn = document.getElementById("orbBtn");
  const toggleBtn = document.getElementById("toggleBtn");
  const optionsBtn = document.getElementById("optionsBtn");
  const copyBtn = document.getElementById("copyBtn");
  const statusTitle = document.getElementById("statusTitle");
  const statusSub = document.getElementById("statusSub");
  const shortcutKbd = document.getElementById("shortcutKbd");
  const lastText = document.getElementById("lastText");
  const lastWhen = document.getElementById("lastWhen");

  const isMac = navigator.platform.toLowerCase().includes("mac");
  shortcutKbd.textContent = isMac ? "⌘⇧Space" : "Ctrl+Shift+Space";

  function renderState(state) {
    document.body.classList.toggle("listening", state === "listening");
    if (state === "listening") {
      statusTitle.textContent = "Listening…";
      statusSub.textContent = "Click the orb again to stop";
      toggleBtn.textContent = "Stop";
    } else if (state === "processing") {
      statusTitle.textContent = "Processing…";
      statusSub.textContent = "Cleaning up your words";
      toggleBtn.textContent = "Working…";
    } else {
      statusTitle.textContent = "Click the orb to dictate";
      statusSub.innerHTML = "";
      statusSub.append("or press ");
      const kbd = document.createElement("span");
      kbd.className = "kbd";
      kbd.textContent = shortcutKbd.textContent;
      statusSub.append(kbd, " on any page");
      toggleBtn.textContent = "Start dictation";
    }
  }

  function renderLast(text, ts) {
    if (!text) return;
    lastText.textContent = text;
    lastText.classList.remove("empty");
    if (ts) {
      const mins = Math.round((Date.now() - ts) / 60000);
      lastWhen.textContent =
        mins < 1 ? "just now" : mins < 60 ? mins + "m ago" : Math.round(mins / 60) + "h ago";
    }
  }

  function toggle() {
    if (!hasChrome) return;
    chrome.runtime.sendMessage({ target: "background", type: "toggle" }).catch(() => {});
  }

  orbBtn.addEventListener("click", toggle);
  toggleBtn.addEventListener("click", toggle);

  optionsBtn.addEventListener("click", () => {
    if (hasChrome) chrome.runtime.openOptionsPage();
  });

  document.getElementById("popoutBtn").addEventListener("click", () => {
    if (!hasChrome) return;
    chrome.runtime
      .sendMessage({ target: "background", type: "open-popout" })
      .then(() => window.close())
      .catch(() => {});
  });

  copyBtn.addEventListener("click", () => {
    const text = lastText.classList.contains("empty") ? "" : lastText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.classList.add("on");
      setTimeout(() => copyBtn.classList.remove("on"), 1200);
    });
  });

  if (hasChrome) {
    chrome.runtime.sendMessage({ target: "background", type: "get-state" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) renderState(res.state);
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.target === "popup" && msg.type === "state-changed") {
        renderState(msg.state);
      }
    });
    chrome.storage.local.get(["history", "lastTranscript"]).then((data) => {
      const entry = (data.history && data.history[0]) || null;
      renderLast(entry ? entry.text : data.lastTranscript, entry ? entry.ts : null);
    });
  } else {
    renderState("idle"); // static preview
  }
})();
