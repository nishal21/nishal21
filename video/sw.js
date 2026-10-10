/* Offline shell for the video page. The page, styles, script, fonts, icons and the video list are
   cached so the library opens without a connection; thumbnails are cached as they're seen.
   Video bytes, range requests and anything from another site are never touched. */
const SHELL = "vp-shell-v1", THUMBS = "vp-thumbs-v1";
const FILES = ["./", "video.css", "video.js", "videos.json", "manifest.webmanifest", "icons/icon-192.png",
  "../player/fonts/bricolage-grotesque.woff2", "../player/fonts/jetbrains-mono.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("vp-") && k !== SHELL && k !== THUMBS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
// network first, so a fresh build shows up at once; the cache covers being offline
async function fresh(req, key) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch {
    return (await cache.match(key || req, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || req.headers.has("range") || url.origin !== location.origin) return;
  if (/\.(mp4|webm|mov|m4v|mkv|ogv|m3u8|mpd|m4s|ts)$/i.test(url.pathname)) return;
  if (req.mode === "navigate") { e.respondWith(fresh(req, "./")); return; }
  if (/\/thumbs\/[\w-]+(-amb)?\.jpg$/.test(url.pathname) || /\/clip-poster\.jpg$/.test(url.pathname)) {
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
