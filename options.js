// Options page: settings + custom words + history.
// Guarded so the page still renders when previewed outside Chrome.

(() => {
  "use strict";

  const hasChrome =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  const DEFAULTS = {
    engine: "chrome",
    language: "en-US",
    cfAccountId: "",
    cfApiToken: "",
    cfGateway: "",
    removeFillers: true,
    spokenPunctuation: true,
    aiPolish: true,
    customWords: [],
    historyLimit: 25,
  };

  const els = {
    engrows: Array.from(document.querySelectorAll(".engrow")),
    cfCreds: document.getElementById("cfCreds"),
    gatewayRow: document.getElementById("gatewayRow"),
    cfAccountId: document.getElementById("cfAccountId"),
    cfApiToken: document.getElementById("cfApiToken"),
    cfGateway: document.getElementById("cfGateway"),
    testBtn: document.getElementById("testBtn"),
    testStatus: document.getElementById("testStatus"),
    language: document.getElementById("language"),
    removeFillers: document.getElementById("removeFillers"),
    spokenPunctuation: document.getElementById("spokenPunctuation"),
    aiPolish: document.getElementById("aiPolish"),
    historyLimit: document.getElementById("historyLimit"),
    chips: document.getElementById("chips"),
    chipInput: document.getElementById("chipInput"),
    shortcutKbd: document.getElementById("shortcutKbd"),
    shortcutsBtn: document.getElementById("shortcutsBtn"),
    histlist: document.getElementById("histlist"),
    clearBtn: document.getElementById("clearBtn"),
  };

  let settings = Object.assign({}, DEFAULTS);

  const isMac = navigator.platform.toLowerCase().includes("mac");
  els.shortcutKbd.textContent = isMac ? "⌘⇧Space" : "Ctrl+Shift+Space";

  async function load() {
    if (hasChrome) {
      const data = await chrome.storage.local.get("settings");
      settings = Object.assign({}, DEFAULTS, data.settings || {});
    } else {
      settings.customWords = ["Kubernetes", "PostgreSQL"]; // static preview
    }
    renderEngine();
    els.cfAccountId.value = settings.cfAccountId || "";
    els.cfApiToken.value = settings.cfApiToken || "";
    els.cfGateway.value = settings.cfGateway || "";
    els.language.value = settings.language;
    els.removeFillers.setAttribute("aria-checked", String(settings.removeFillers));
    els.spokenPunctuation.setAttribute("aria-checked", String(settings.spokenPunctuation));
    els.aiPolish.setAttribute("aria-checked", String(settings.aiPolish));
    els.historyLimit.value = settings.historyLimit;
    renderChips();
    renderHistory();
  }

  async function save() {
    if (hasChrome) await chrome.storage.local.set({ settings });
  }

  // ----- speech engine -----
  function renderEngine() {
    els.engrows.forEach((row) => {
      row.setAttribute("aria-checked", String(row.dataset.engine === settings.engine));
    });
    els.cfCreds.hidden = settings.engine === "chrome";
    els.gatewayRow.style.display = settings.engine === "cf-flux" ? "" : "none";
  }

  els.engrows.forEach((row) => {
    const pick = () => {
      settings.engine = row.dataset.engine;
      renderEngine();
      save();
    };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
  });

  function wireCredField(el, key) {
    el.addEventListener("change", () => {
      settings[key] = el.value.trim();
      save();
    });
  }
  wireCredField(els.cfAccountId, "cfAccountId");
  wireCredField(els.cfApiToken, "cfApiToken");
  wireCredField(els.cfGateway, "cfGateway");

  els.testBtn.addEventListener("click", async () => {
    const id = els.cfAccountId.value.trim();
    const token = els.cfApiToken.value.trim();
    els.testStatus.className = "teststatus";
    if (!id || !token) {
      els.testStatus.textContent = "Enter Account ID and token first";
      els.testStatus.classList.add("err");
      return;
    }
    els.testStatus.textContent = "Testing…";
    try {
      const resp = await fetch(
        "https://api.cloudflare.com/client/v4/accounts/" +
          encodeURIComponent(id) + "/ai/models/search?search=whisper",
        { headers: { Authorization: "Bearer " + token } }
      );
      const json = await resp.json();
      if (json.success) {
        els.testStatus.textContent = "Connected ✓";
        els.testStatus.classList.add("ok");
      } else {
        els.testStatus.textContent =
          (json.errors && json.errors[0] && json.errors[0].message) || "Rejected";
        els.testStatus.classList.add("err");
      }
    } catch (_) {
      els.testStatus.textContent = "Network error";
      els.testStatus.classList.add("err");
    }
  });

  // ----- general -----
  els.language.addEventListener("change", () => {
    settings.language = els.language.value;
    save();
  });

  function wireToggle(el, key) {
    el.addEventListener("click", () => {
      settings[key] = el.getAttribute("aria-checked") !== "true";
      el.setAttribute("aria-checked", String(settings[key]));
      save();
    });
  }
  wireToggle(els.removeFillers, "removeFillers");
  wireToggle(els.spokenPunctuation, "spokenPunctuation");
  wireToggle(els.aiPolish, "aiPolish");

  els.historyLimit.addEventListener("change", () => {
    const n = Math.max(0, Math.min(500, parseInt(els.historyLimit.value, 10) || 0));
    els.historyLimit.value = n;
    settings.historyLimit = n;
    save();
  });

  // ----- custom words -----
  function renderChips() {
    els.chips.innerHTML = "";
    if (settings.customWords.length === 0) {
      const em = document.createElement("span");
      em.className = "empty";
      em.textContent = "No custom words yet.";
      els.chips.appendChild(em);
      return;
    }
    settings.customWords.forEach((word, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.append(word);
      const x = document.createElement("button");
      x.textContent = "✕";
      x.setAttribute("aria-label", "Remove " + word);
      x.addEventListener("click", () => {
        settings.customWords.splice(i, 1);
        renderChips();
        save();
      });
      chip.appendChild(x);
      els.chips.appendChild(chip);
    });
  }

  els.chipInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const word = els.chipInput.value.trim().replace(/\s+/g, "");
    if (!word) return;
    if (!settings.customWords.some((w) => w.toLowerCase() === word.toLowerCase())) {
      settings.customWords.push(word);
      renderChips();
      save();
    }
    els.chipInput.value = "";
  });

  // ----- shortcut -----
  els.shortcutsBtn.addEventListener("click", () => {
    if (hasChrome) chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  // ----- history -----
  async function renderHistory() {
    els.histlist.innerHTML = "";
    let history = [];
    if (hasChrome) {
      const data = await chrome.storage.local.get("history");
      history = data.history || [];
    }
    if (history.length === 0) {
      const em = document.createElement("div");
      em.className = "empty";
      em.textContent = "Transcriptions will appear here.";
      els.histlist.appendChild(em);
      return;
    }
    for (const entry of history) {
      const row = document.createElement("div");
      row.className = "hist";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = entry.text;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(entry.ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const copy = document.createElement("button");
      copy.className = "cbtn";
      copy.title = "Copy";
      copy.setAttribute("aria-label", "Copy transcription");
      copy.textContent = "⧉";
      copy.addEventListener("click", () => navigator.clipboard.writeText(entry.text));
      row.append(t, when, copy);
      els.histlist.appendChild(row);
    }
  }

  els.clearBtn.addEventListener("click", async () => {
    if (hasChrome) await chrome.storage.local.remove(["history", "lastTranscript"]);
    renderHistory();
  });

  if (hasChrome) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.history) renderHistory();
    });
  }

  load();
})();
