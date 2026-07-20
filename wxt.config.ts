import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// Bobby Speak V2 — see ARCHITECTURE.md. The manifest stays deliberately close
// to v1's: same permissions, same commands, same product.
export default defineConfig({
  modules: ["@wxt-dev/module-svelte"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Bobby Speak",
    icons: {
      16: "/icon/16.png",
      48: "/icon/48.png",
      128: "/icon/128.png",
    },
    description:
      "Voice dictation for the browser. Press the shortcut, speak, and text lands at your cursor — streaming as you talk.",
    permissions: [
      "offscreen",
      "storage",
      "activeTab",
      "scripting",
      "clipboardWrite",
    ],
    host_permissions: ["<all_urls>"],
    commands: {
      // ONE shortcut for everything. Global scope (fires even when Chrome
      // is not the focused app) — Chrome restricts global commands to
      // Ctrl/Command+Shift+0-9, which is why it's "1" and not Space.
      "dictate-from-anywhere": {
        suggested_key: { default: "Ctrl+Shift+1", mac: "Command+Shift+1" },
        description: "Start / stop dictation — in Chrome or any app",
        global: true,
      },
    },
  },
});
