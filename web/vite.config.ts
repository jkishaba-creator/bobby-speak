import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// The mobile web app (PWA). Shares src/ and assets/ with the extension —
// same pipeline, same design tokens, different shell.
export default defineConfig({
  root: here,
  base: "./",
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../.output/web", import.meta.url)),
    emptyOutDir: true,
  },
});
