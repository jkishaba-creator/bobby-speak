// Output layer: the Air OS overlay pill, in a closed shadow root so page CSS
// can't touch it. Visuals carried over from v1 unchanged — V2 is wiring.

import type { LevelFrame } from "../shared/types";

interface OverlayUi {
  pill: HTMLElement;
  wave: HTMLElement;
  bars: HTMLElement[];
  spinner: HTMLElement;
  label: HTMLElement;
  preview: HTMLElement;
}

let host: HTMLElement | null = null;
let ui: OverlayUi | null = null;

function ensureOverlay(): OverlayUi {
  if (ui) return ui;
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
    <div class="pill">
      <span class="wave">${"<i></i>".repeat(9)}</span>
      <span class="spinner hidden"></span>
      <span class="label">Listening</span>
      <span class="preview"></span>
    </div>`;
  document.documentElement.appendChild(host);
  ui = {
    pill: root.querySelector(".pill")!,
    wave: root.querySelector(".wave")!,
    bars: Array.from(root.querySelectorAll(".wave i")),
    spinner: root.querySelector(".spinner")!,
    label: root.querySelector(".label")!,
    preview: root.querySelector(".preview")!,
  };
  return ui;
}

export function showListening(): void {
  const u = ensureOverlay();
  u.wave.classList.remove("hidden");
  u.spinner.classList.add("hidden");
  u.label.textContent = "Listening";
  u.label.classList.remove("err");
  u.preview.textContent = "";
  requestAnimationFrame(() => u.pill.classList.add("visible"));
}

export function showProcessing(): void {
  const u = ensureOverlay();
  u.wave.classList.add("hidden");
  u.spinner.classList.remove("hidden");
  u.label.textContent = "Processing";
  u.pill.classList.add("visible");
}

export function showError(message: string): void {
  const u = ensureOverlay();
  u.wave.classList.add("hidden");
  u.spinner.classList.add("hidden");
  u.label.textContent = message;
  u.label.classList.add("err");
  u.preview.textContent = "";
  u.pill.classList.add("visible");
}

export function hide(): void {
  ui?.pill.classList.remove("visible");
}

export function setLevels(levels: LevelFrame): void {
  if (!ui) return;
  ui.bars.forEach((bar, i) => {
    bar.style.height = Math.max(4, Math.round((levels[i] ?? 0) * 18)) + "px";
  });
}

export function setText(committed: string, tentative: string): void {
  if (!ui) return;
  if (!committed && !tentative) {
    ui.preview.textContent = "";
    return;
  }
  ui.preview.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = committed;
  ui.preview.appendChild(b);
  ui.preview.appendChild(document.createTextNode(tentative));
}
