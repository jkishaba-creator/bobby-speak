import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// The mobile web app (PWA). Shares src/ and assets/ with the extension —
// same pipeline, same design tokens, different shell.
//
// The web page calls /api/ai (same origin) because browsers cannot reach
// api.cloudflare.com directly — it sends no CORS headers. In production that
// path is served by functions/api/ai.ts on Cloudflare Pages; locally, the dev
// server proxies it here so `npm run dev:web` behaves identically. (The
// extension has no proxy — host permissions let it call Cloudflare directly.)
export default defineConfig({
  root: here,
  base: "./",
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../.output/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api/ai": {
        target: "https://api.cloudflare.com",
        changeOrigin: true,
        rewrite: () => "/client/v4/accounts/__DEV__/ai/run/__DEV__",
        configure: (proxy: any) => {
          proxy.on("proxyReq", (proxyReq: any, req: any) => {
            const account = req.headers["x-cf-account"];
            const token = req.headers["x-cf-token"];
            const model = req.headers["x-cf-model"];
            if (account && model) {
              proxyReq.path = `/client/v4/accounts/${account}/ai/run/${model}`;
            }
            if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
            proxyReq.removeHeader("x-cf-account");
            proxyReq.removeHeader("x-cf-token");
            proxyReq.removeHeader("x-cf-model");
          });
        },
      },
    },
  },
});
