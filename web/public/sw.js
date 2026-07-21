// Minimal app-shell cache: makes the PWA installable and lets the UI open
// offline. Transcription itself needs the network, so API calls are never
// cached — only the shell.
//
// Strategy matters here: navigations are network-FIRST so a redeploy is seen
// immediately (cache-first on index.html means users keep running the old
// build forever). Hashed assets are cache-first, which is safe because their
// filenames change whenever their contents do.
const CACHE = "bobby-speak-shell-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["./", "./index.html"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never touch API traffic or non-GETs.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigations: the fresh build wins; cache is only the offline fallback.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  // Hashed assets: cache-first is safe, filenames change on every build.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
    ),
  );
});
