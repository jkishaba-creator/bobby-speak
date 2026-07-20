import { DEFAULT_SETTINGS, type Settings } from "./types";

// Settings live in chrome.storage.local under one key, exactly like v1, so
// upgrading from v1 keeps every user preference.
const KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(data[KEY] ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}
