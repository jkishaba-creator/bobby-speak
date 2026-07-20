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
      "toggle-dictation": {
        suggested_key: {
          default: "Ctrl+Shift+Space",
          mac: "Command+Shift+Space",
        },
        description: "Start / stop dictation",
      },
      "open-popout": {
        suggested_key: { default: "Ctrl+Shift+O", mac: "Command+Shift+O" },
        description: "Open the pop-out (dictate for other apps)",
      },
      // Global commands fire even when Chrome is NOT the focused app.
      // Chrome restricts them to Ctrl/Command+Shift+0-9.
      "dictate-from-anywhere": {
        suggested_key: { default: "Ctrl+Shift+1", mac: "Command+Shift+1" },
        description: "Dictate from ANY app — result lands on the clipboard",
        global: true,
      },
    },
  },
});
