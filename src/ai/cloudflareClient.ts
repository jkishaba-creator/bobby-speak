// One place that knows how to reach Workers AI, from either shell this code
// runs in — the Chrome extension or the mobile web page.
//
// The two shells have opposite constraints:
//
//   Extension — host permissions let it call api.cloudflare.com directly;
//   CORS does not apply. There is no same-origin proxy to hit (the extension
//   is loaded from chrome-extension://, not from a Pages deployment), so the
//   proxy path would simply 404. It must go direct, Bearer token and all.
//
//   Web page — browsers cannot call api.cloudflare.com directly (it sends no
//   CORS headers), so every request goes to a same-origin proxy: the Pages
//   Function at functions/api/ai.ts in production, Vite's dev-server proxy
//   locally. Credentials travel in headers so the proxy stays a pass-through.
//
// runCloudflareModel picks the path by detecting the shell, so the three call
// sites (Whisper ASR, grammar polish, text actions) never have to care.

export const AI_PROXY_PATH = "/api/ai";

export interface CloudflareCreds {
  accountId: string;
  apiToken: string;
}

/** True when running inside the Chrome extension (host permissions bypass CORS). */
function inExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id;
}

export async function runCloudflareModel(
  model: string,
  creds: CloudflareCreds,
  payload: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  if (inExtension()) {
    // Model IDs contain "@" and "/" that Cloudflare wants literal in the path,
    // so the id is appended raw after the encoded account id.
    const url =
      "https://api.cloudflare.com/client/v4/accounts/" +
      encodeURIComponent(creds.accountId) +
      "/ai/run/" +
      model;
    return fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: "Bearer " + creds.apiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  return fetch(AI_PROXY_PATH, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-cf-account": creds.accountId,
      "x-cf-token": creds.apiToken,
      "x-cf-model": model,
    },
    body: JSON.stringify(payload),
  });
}
