import { DEFAULT_SETTINGS, type Settings } from "./types";

// One settings store, two surfaces. The extension has chrome.storage.local;
// the mobile web app (PWA) has no chrome.* APIs at all, so it falls back to
// localStorage. Same key, same shape — which is what lets the entire
// pipeline, provider, and processing code run unchanged on both.
const KEY = "settings";

// Cloudflare retires models; a saved setting can outlive the model it names
// and every AI call then fails with "this model was deprecated".
const RETIRED_MODELS = new Set([
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3-8b-instruct",
]);

function migrate(settings: Settings): Settings {
  return RETIRED_MODELS.has(settings.cfTextModel)
    ? { ...settings, cfTextModel: DEFAULT_SETTINGS.cfTextModel }
    : settings;
}

const hasChromeStorage =
  typeof chrome !== "undefined" && !!chrome?.storage?.local;

export async function getSettings(): Promise<Settings> {
  if (hasChromeStorage) {
    const data = await chrome.storage.local.get(KEY);
    return migrate({ ...DEFAULT_SETTINGS, ...(data[KEY] ?? {}) });
  }
  try {
    const raw = localStorage.getItem(KEY);
    return migrate({ ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) });
  } catch {
    // Private mode, disabled storage, or corrupt JSON — defaults still work.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [KEY]: settings });
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Quota or private mode: settings just won't persist this session.
  }
}
