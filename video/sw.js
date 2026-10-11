/* Offline shell for the video page. The page, styles, script, fonts, icons and the video list are
   cached so the library opens without a connection; thumbnails are cached as they're seen.
   Video bytes, range requests and anything from another site are never touched.
   The build stamps BUILD with a hash of the files, so every deploy gets fresh cache names. */
const BUILD = "dev";
const SHELL = "vp-shell-" + BUILD, THUMBS = "vp-thumbs-v1";
const FILES = ["./", "video.css", "video.js", "menu.css", "menu.js", "gestures.js", "vendor/ambilight/ambilight.js", "videos.json", "manifest.webmanifest", "icons/icon-192.png",
  "../player/fonts/bricolage-grotesque.woff2", "../player/fonts/jetbrains-mono.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL)
    .then((c) => Promise.all(FILES.map((f) => fetch(f, { cache: "no-cache" }).then((r) => r.ok && c.put(f, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("vp-") && k !== SHELL && k !== THUMBS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
// Online, always ask the server (no-cache revalidates past the browser's own 10-minute cache, so a new
// deploy shows up on the next load). The saved copy, keyed without ?v=, is only for being offline.
async function fresh(req, key) {
  const cache = await caches.open(SHELL);
  const url = new URL(req.url);
  const bare = key || url.origin + url.pathname;
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(bare, res.clone());
    return res;
  } catch {
    return (await cache.match(bare, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || req.headers.has("range") || url.origin !== location.origin) return;
  if (/\.(mp4|webm|mov|m4v|mkv|ogv|m3u8|mpd|m4s|ts)$/i.test(url.pathname)) return;
  if (req.mode === "navigate") { e.respondWith(fresh(req, new URL("./", self.registration.scope).href)); return; }
  if (/\/thumbs\/[\w-]+(-amb)?\.jpg$/.test(url.pathname) || /\/(clip|trailer)-poster\.jpg$/.test(url.pathname)) {
    e.respondWith(caches.open(THUMBS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trim(c, 160); }
      return res;
    }));
    return;
  }
  const scope = new URL(self.registration.scope);
  if (url.pathname.startsWith(scope.pathname) || url.pathname.includes("/player/fonts/")) e.respondWith(fresh(req));
});
