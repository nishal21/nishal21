/* Video player: the nightly share clip, Nishal's YouTube uploads, and any link or file.
   One <video> element plays files, HLS (hls.js, loaded on demand) and DASH (dash.js, on demand).
   YouTube runs through the IFrame Player API and Vimeo through its postMessage API, both under
   our controls where the provider allows it; other sites play in a sandboxed embed with their own
   controls. No frameworks, nothing loaded from a CDN. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const root = document.documentElement;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");
const store = {
  get(k, d) { try { const v = localStorage.getItem("vp:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vp:" + k, JSON.stringify(v)); } catch {} },
};
function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

const stage = $("#stage"), video = $("#video"), embedBox = $("#embed"), shield = $("#shield");
const seek = $("#seek"), scrub = $("#scrub"), bigPlay = $("#big-play"), playBtn = $("#play");
const glowBox = $(".glow"), glow = $("#glow");

/* ---------- theme (same rules as the song player, shared localStorage key) ---------- */
const schemeMeta = $('meta[name="color-scheme"]');
const sysDark = matchMedia("(prefers-color-scheme: dark)");
const rendered = () => (schemeMeta.content === "light dark" ? (sysDark.matches ? "dark" : "light") : schemeMeta.content);
$("#theme").addEventListener("click", () => {
  const target = rendered() === "dark" ? "light" : "dark";
  const system = sysDark.matches ? "dark" : "light";
  try { target === system ? localStorage.removeItem("color-scheme") : localStorage.setItem("color-scheme", target); } catch {}
  schemeMeta.content = target === system ? "light dark" : target;
  setThemeColor();
});
addEventListener("storage", (e) => { if (e.key === "color-scheme") { schemeMeta.content = e.newValue ?? "light dark"; setThemeColor(); } });
sysDark.addEventListener?.("change", setThemeColor);
const probe = el("i", { hidden: true });
document.body.append(probe);
const cssColor = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
function setThemeColor() { $('meta[name="theme-color"]').content = cssColor("var(--bg)"); }

/* ---------- colour helpers ---------- */
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const hsl = (h, s, l) => `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function luminance(css) {
  const [r, g, b] = cssColor(css).match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Accent from a video's main colour; greys keep the default lime.
function applyAccent(hex) {
  const st = root.style;
  const [h, s] = hex ? rgbToHsl(hexRgb(hex)) : [0, 0];
  if (!hex || s < 0.14) { ["--g", "--g-deep", "--bg-d", "--bg-l"].forEach((p) => st.removeProperty(p)); setThemeColor(); return; }
  const sat = clamp(s, 0.55, 0.9);
  const bgL = hsl(h, Math.min(sat, 0.35), 0.93);
  let L = 0.42, deep = hsl(h, sat * 0.9, L);
  while (contrast(deep, bgL) < 4.5 && L > 0.1) { L -= 0.02; deep = hsl(h, sat * 0.9, L); }
  st.setProperty("--g", hsl(h, sat, 0.7));
  st.setProperty("--g-deep", deep);
  st.setProperty("--bg-d", hsl(h, Math.min(sat, 0.28), 0.065));
  st.setProperty("--bg-l", bgL);
  setThemeColor();
}

/* ---------- toast + bezel ---------- */
let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function bezel(content) {
  const b = $("#bezel");
  b.replaceChildren();
  if (content.startsWith("#")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", content);
    svg.append(use);
    b.append(svg);
  } else b.textContent = content;
  b.classList.remove("show");
  void b.offsetWidth;
  b.classList.add("show");
}

/* ---------- link parsing: every supported site, nothing else ---------- */
const YT_ID = /^[\w-]{11}$/;
// "90", "90s", "1m30s", "1h2m3s", "1:30", "1:02:03"
function parseTime(v) {
  if (!v) return 0;
  v = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?s?$/.test(v)) return parseFloat(v);
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(v)) return v.split(":").reduce((a, b) => a * 60 + +b, 0);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}
function parseT(u) {
  const q = u.searchParams;
  return parseTime(q.get("t") || q.get("start") || q.get("time_continue") || q.get("startTime") || (u.hash.match(/(?:^#|&)t=([\dhms:.]+)/) || [])[1]);
}
const fileName = (u) => { try { return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "") || u.hostname; } catch { return u.hostname; } };
// tracking junk that never changes what plays
const TRACKING = /^(utm_[a-z]+|si|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igsh|igshid|feature|pp|ab_channel|ref|ref_src|ref_url|share_id|is_from_webapp|sender_device|_r|_t|s|embeds_referring_euri|embeds_referring_origin|source_ve_path|xmt|mibextid|rdid|share_app_id)$/i;
function stripTracking(u, all) {
  for (const k of [...u.searchParams.keys()]) if (all ? TRACKING.test(k) : /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igsh|igshid)$/i.test(k)) u.searchParams.delete(k);
  return u;
}
// pull the link out of pasted text: "watch this → https://youtu.be/x?si=… !!", <https://…>, "quoted"
function extractUrl(s) {
  s = s.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  const m = s.match(/(?:https?:\/\/|\/\/|www\.)[^\s<>"'`]+/i) || s.match(/\b(?:[a-z\d-]+\.)+[a-z]{2,}\/[^\s<>"'`]*/i);
  let out = m ? m[0] : s;
  out = out.replace(/[)\].,;:!?'"»”’]+$/, (t) => (out.includes("(") && t.startsWith(")") ? ")" : ""));
  return out;
}
// redirect wrappers from Google, YouTube, Facebook, Slack, Outlook and friends
function unwrap(u) {
  for (let i = 0; i < 3; i++) {
    const h = u.hostname.replace(/^www\./, ""), q = u.searchParams;
    let inner = null;
    if ((h === "google.com" || h.startsWith("google.")) && u.pathname === "/url") inner = q.get("q") || q.get("url");
    else if (h === "youtube.com" && u.pathname === "/redirect") inner = q.get("q");
    else if (h === "youtube.com" && u.pathname === "/attribution_link") inner = "https://www.youtube.com" + (q.get("u") || "");
    else if (/^l[m]?\.(facebook|instagram)\.com$/.test(h)) inner = q.get("u");
    else if (h === "t.umblr.com" || h === "href.li") inner = q.get("z") || u.search.slice(1);
    else if (h.endsWith("safelinks.protection.outlook.com")) inner = q.get("url");
    else if (h === "slack-redir.net") inner = q.get("url");
    if (!inner) return u;
    try { u = new URL(inner); } catch { return u; }
  }
  return u;
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
const MEDIA_EXT = ["mp4", "m4v", "webm", "mov", "ogv", "ogg", "mkv", "mp3", "m4a", "opus", "wav", "flac", "aac"];
const NOT_VIDEO_EXT = ["html", "htm", "php", "asp", "aspx", "jsp", "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "pdf", "zip", "rar", "7z", "doc", "docx", "txt", "json", "xml", "js", "css"];
const DRM_SITES = { "netflix.com": "Netflix", "primevideo.com": "Prime Video", "hotstar.com": "JioHotstar", "jiohotstar.com": "JioHotstar", "disneyplus.com": "Disney+", "hulu.com": "Hulu", "max.com": "Max", "tv.apple.com": "Apple TV", "sonyliv.com": "Sony LIV", "zee5.com": "ZEE5", "crunchyroll.com": "Crunchyroll", "spotify.com": "Spotify" };

function parseLink(raw) {
  let s = String(raw || "").trim();
  if (!s) return { error: "Paste a link first." };
  if (s.length > 4096) return { error: "That link is too long." };
  if (/^(blob|file|data|javascript|vbscript|about|chrome|content|filesystem):/i.test(s)) return { error: "Only web links work here. To play a file from your device, choose it or drop it on the player." };
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(s) && !/^https?:/i.test(s)) return { error: "Only http and https links can be played here." };
  s = extractUrl(s);
  if (YT_ID.test(s)) return { kind: "youtube", id: s, src: "https://youtu.be/" + s };
  if (/^\/\//.test(s)) s = "https:" + s;
  if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return { error: "That doesn't look like a link. Paste the full address, starting with https://" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only http and https links can be played here." };
  if (u.username || u.password) return { error: "Links with a username or password in them aren't allowed." };
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return { error: "That doesn't look like a link. Paste the full address, starting with https://" };
  u = unwrap(u);
  const full = u.hostname.toLowerCase();
  const host = full.replace(/^(www|m|music|mobile|gaming)\./, "");
  const p = u.pathname, start = parseT(u);
  const known = (h) => host === h || host.endsWith("." + h);
  // providers get every tracking key stripped; plain files keep their query (signed links need it)
  const clean = () => stripTracking(new URL(u), true).href;
  const embed = (provider, url, shape = "wide", extra = {}) => ({ kind: "embed", provider, embed: url, src: clean(), shape, start, ...extra });

  if (known("youtube.com") || host === "youtube-nocookie.com" || host === "youtu.be") {
    if (/^\/(@|c\/|channel\/|user\/)/.test(p)) return { error: "That's a YouTube channel. Open one of its videos and copy that link." };
    if (/^\/clip\//.test(p)) return { error: "YouTube clips can't be opened outside YouTube. Copy the full video's link instead (add &t= for the moment you want)." };
    if (/^\/(results|feed|hashtag)/.test(p)) return { error: "That's a YouTube page, not a video. Open the video and copy its link." };
    const id = host === "youtu.be" ? p.slice(1, 12) : u.searchParams.get("v") || (p.match(/^\/(?:shorts|embed|live|v|e|watch)\/([\w-]{11})/) || [])[1];
    const list = u.searchParams.get("list");
    const okList = list && /^[\w-]{10,64}$/.test(list) && !/^RD/.test(list) ? list : null; // RD… mixes are personal and can't be embedded
    const src = id && p.startsWith("/shorts/") ? `https://www.youtube.com/shorts/${id}` : id ? `https://www.youtube.com/watch?v=${id}${okList ? "&list=" + okList : ""}${start ? "&t=" + Math.floor(start) : ""}` : `https://www.youtube.com/playlist?list=${okList}`;
    if (id && YT_ID.test(id)) return { kind: "youtube", id, list: okList, start, short: p.startsWith("/shorts/"), src };
    if (okList) return { kind: "youtube", list: okList, src };
    return { error: "That YouTube link doesn't point to a video or playlist." };
  }
  if (known("vimeo.com")) {
    // vimeo.com/123, /123/abcdef (unlisted), /channels/x/123, /groups/x/videos/123, /showcase/1/video/123, player.vimeo.com/video/123?h=abc
    const m = p.match(/(?:^|\/)(\d{5,12})(?:\/([\da-f]{6,20}))?\/?$/) || p.match(/\/video\/(\d{5,12})/);
    if (m) return { kind: "vimeo", id: m[1], hash: m[2] || u.searchParams.get("h") || "", start, src: `https://vimeo.com/${m[1]}${m[2] || u.searchParams.get("h") ? "/" + (m[2] || u.searchParams.get("h")) : ""}${start ? "#t=" + Math.floor(start) + "s" : ""}` };
    return { error: "That Vimeo link doesn't point to a single video." };
  }
  if (known("twitch.tv")) {
    const parent = `&parent=${encodeURIComponent(location.hostname)}`;
    const t = start ? `&time=${Math.floor(start / 3600)}h${Math.floor((start % 3600) / 60)}m${Math.floor(start % 60)}s` : "";
    let m;
    if (host === "clips.twitch.tv") {
      const slug = u.searchParams.get("clip") || (p.match(/^\/(?:embed\/?)?([\w-]{4,100})?$/) || [])[1];
      if (slug && /^[\w-]{4,100}$/.test(slug)) return embed("Twitch", `https://clips.twitch.tv/embed?clip=${slug}${parent}&autoplay=false`);
    }
    if ((m = p.match(/^\/\w+\/clip\/([\w-]{4,100})/))) return embed("Twitch", `https://clips.twitch.tv/embed?clip=${m[1]}${parent}&autoplay=false`);
    if ((m = p.match(/^\/(?:\w+\/)?videos?\/(\d+)/))) return embed("Twitch", `https://player.twitch.tv/?video=v${m[1]}${parent}${t}&autoplay=false`);
    if (host === "twitch.tv" && (m = p.match(/^\/(\w{3,25})\/?$/)) && !["directory", "videos", "search", "settings"].includes(m[1])) return embed("Twitch", `https://player.twitch.tv/?channel=${m[1]}${parent}&autoplay=false`);
    return { error: "That Twitch link isn't a clip, video or channel." };
  }
  if (known("dailymotion.com") || host === "dai.ly") {
    const m = host === "dai.ly" ? p.match(/^\/(x[\da-z]+)/i) : p.match(/\/video\/(x[\da-z]+)/i) || [null, u.searchParams.get("video")];
    if (m?.[1] && /^x[\da-z]+$/i.test(m[1])) return embed("Dailymotion", `https://geo.dailymotion.com/player.html?video=${m[1]}${start ? "&startTime=" + Math.floor(start) : ""}`, "wide", { thumb: `https://www.dailymotion.com/thumbnail/video/${m[1]}` });
    return { error: "That Dailymotion link doesn't point to a video." };
  }
  if (host === "streamable.com") { const m = p.match(/^\/(?:[eo]\/)?(\w{4,12})\/?$/); if (m) return embed("Streamable", `https://streamable.com/e/${m[1]}${start ? "#t=" + Math.floor(start) : ""}`); return { error: "That Streamable link doesn't point to a video." }; }
  if (known("loom.com")) { const m = p.match(/^\/(?:share|embed)\/(?:[\w-]*-)?([\da-f]{32})/); if (m) return embed("Loom", `https://www.loom.com/embed/${m[1]}${start ? "?t=" + Math.floor(start) : ""}`); return { error: "That Loom link doesn't point to a video. Copy the share link." }; }
  if (host === "drive.google.com" || host === "docs.google.com" && /\/file\/d\//.test(p)) {
    const id = (p.match(/\/file\/d\/([\w-]{10,})/) || [])[1] || u.searchParams.get("id");
    if (id && /^[\w-]{10,}$/.test(id)) return embed("Google Drive", `https://drive.google.com/file/d/${id}/preview`);
    return { error: "That Google Drive link is a folder or page, not one file. Open the video, choose Share, and copy its link." };
  }
  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com" || host === "dl.dropbox.com") {
    if (/^\/(home|work|request)/.test(p) || /^\/sh\//.test(p)) return { error: "That Dropbox link is a folder or your own files page. Share the video itself and copy that link." };
    const d = new URL(u);
    if (host === "dropbox.com") { d.searchParams.delete("dl"); d.searchParams.delete("st"); d.searchParams.set("raw", "1"); }
    return { kind: "file", src: d.href, start, title: fileName(d), via: "Dropbox", guessed: !MEDIA_EXT.includes((fileName(d).toLowerCase().match(/\.(\w+)$/) || [])[1]) };
  }
  if (host === "1drv.ms" || known("onedrive.live.com") || full.endsWith(".sharepoint.com")) {
    if (host === "onedrive.live.com" && p.startsWith("/embed")) return embed("OneDrive", u.href);
    if (full.endsWith(".sharepoint.com")) { const d = new URL(u); d.searchParams.set("download", "1"); return { kind: "file", src: d.href, start, title: "OneDrive video", via: "OneDrive", guessed: true }; }
    // public OneDrive share link → the shares API serves the file itself
    return { kind: "file", src: `https://api.onedrive.com/v1.0/shares/u!${b64url(u.href)}/root/content`, start, title: "OneDrive video", via: "OneDrive", guessed: true };
  }
  if (host === "archive.org") { const m = p.match(/^\/(?:details|embed)\/([\w.-]+)/); if (m) return embed("Internet Archive", `https://archive.org/embed/${m[1]}`); return { error: "That Internet Archive link isn't an item." }; }
  if (host === "v.redd.it") { const m = p.match(/^\/(\w{6,20})/); if (m) return { kind: "hls", src: `https://v.redd.it/${m[1]}/HLSPlaylist.m3u8`, start, title: "Reddit video", via: "Reddit" }; }
  if (known("reddit.com") || host === "redd.it") return { error: "Reddit pages can't be read from here. Open the video, copy its v.redd.it link, and paste that." };
  // Social sites only play inside their own apps here: no third-party social embeds, just a way out
  const social = host === "tiktok.com" || host.endsWith(".tiktok.com") ? "TikTok" : host === "instagram.com" ? "Instagram"
    : host === "facebook.com" || host === "fb.watch" || host === "web.facebook.com" ? "Facebook"
    : host === "x.com" || host === "twitter.com" || host === "fxtwitter.com" || host === "vxtwitter.com" ? "X"
    : known("smolish.com") ? "Smolish" : null;
  if (social) return { kind: "external", provider: social, src: clean(), shape: "wide" };
  // Indee's embeddable player has no link form: it needs the site's API key, the viewer's Indee login and DRM,
  // set up by a server. A static page can't hold those safely, so Indee links get a clear answer instead.
  if (known("indee.tv")) return { error: "Indee screeners are protected and need your Indee login, so they only play on Indee itself. Open the link in a new tab to watch there." };
  for (const [d, name] of Object.entries(DRM_SITES)) if (known(d)) return { error: `${name} protects its videos, so they only play on ${name} itself.` };

  const fu = stripTracking(new URL(u), false);
  if (/^#t=/.test(fu.hash)) fu.hash = ""; // the start time travels separately
  const src = fu.href;
  const ext = (p.toLowerCase().match(/\.([a-z\d]{2,5})$/) || [])[1];
  const fmtHint = (u.searchParams.get("format") || u.searchParams.get("type") || "").toLowerCase();
  if (ext === "m3u8" || ext === "m3u" || /m3u8|hls/.test(fmtHint) || /\/manifest\(format=m3u8/i.test(p)) return { kind: "hls", src, start, title: fileName(u) };
  if (ext === "mpd" || /mpd|dash/.test(fmtHint) || /\/manifest\(format=mpd/i.test(p)) return { kind: "dash", src, start, title: fileName(u) };
  if (NOT_VIDEO_EXT.includes(ext)) return { error: ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext) ? "That's a link to a picture, not a video." : "That link is a web page or document, not a video. Open the page, right-click the video and copy its address, or paste a link from a supported site." };
  const guessed = !MEDIA_EXT.includes(ext);
  return { kind: "file", src, start, title: guessed ? u.hostname.replace(/^www\./, "") : fileName(u), guessed };
}

/* Links with no file extension: ask the server what it is when it allows us to (CORS), otherwise
   let <video> try and explain if it fails. */
async function probeLink(x) {
  if (x.kind !== "file" || !x.guessed || x.via) return x;
  const types = (ct) => {
    ct = (ct || "").toLowerCase();
    if (/mpegurl/.test(ct)) return "hls";
    if (/dash\+xml/.test(ct)) return "dash";
    if (/^(video|audio)\//.test(ct) || /octet-stream/.test(ct)) return "file";
    if (/^text\/html|xhtml/.test(ct)) return "page";
    if (/^image\//.test(ct)) return "image";
    return null;
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    let r = await fetch(x.src, { method: "HEAD", mode: "cors", credentials: "omit", signal: ctl.signal, redirect: "follow" });
    if (r.status === 405 || r.status === 403) r = await fetch(x.src, { headers: { Range: "bytes=0-1" }, mode: "cors", credentials: "omit", signal: ctl.signal });
    const kind = types(r.headers.get("content-type"));
    r.body?.cancel?.();
    if (kind === "page") return { error: "That link is a web page with no video this player can reach. Open the page, right-click the video and copy its address, or paste a link from a supported site." };
    if (kind === "image") return { error: "That's a link to a picture, not a video." };
    if (kind) return { ...x, kind, guessed: kind === "file" ? false : x.guessed, probed: true };
  } catch {} finally { clearTimeout(timer); }
  return x; // the server doesn't say; <video> gets a go and the error handler explains a failure
}

/* ---------- the library ---------- */
const SITE = new URL("./", location.href);
const CLIP = {
  key: "clip", kind: "file", src: new URL("../player/share-clip.mp4", SITE).href, shape: "tall", loop: true,
  eyebrow: "Share clip · rebuilt every night", title: "Contribution song, busiest week", thumb: "clip-poster.jpg",
  download: { href: "../player/share-clip.mp4", name: "nishal-contribution-clip.mp4", label: "Download clip" },
  share: "clip", artist: "Nishal K",
};
let library = [];
let channel = { handle: "@DemonKing0.___", url: "https://www.youtube.com/@DemonKing0.___", name: "DemonKing" };
const nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (!isFinite(s)) return "";
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  }
  return "just now";
}
function ytItem(v) {
  return {
    key: "yt:" + v.id, kind: "youtube", id: v.id, short: !!v.isShort, shape: v.isShort ? "tall" : "wide",
    title: v.title, eyebrow: v.isShort ? "YouTube Short" : "YouTube", published: v.published, views: v.views, duration: v.duration,
    thumb: v.thumb || v.thumbnail, remoteThumb: !v.thumb, colors: v.colors, amb: v.amb, description: v.description, chapters: Array.isArray(v.chapters) ? v.chapters.filter((c) => c && isFinite(c.t) && typeof c.title === "string").map((c) => ({ t: +c.t, title: c.title.slice(0, 100) })) : null,
    href: v.isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`, openLabel: "Open on YouTube",
    share: v.id, artist: channel.name || "DemonKing",
  };
}
function metaLine(it) {
  if (it === CLIP) return CLIP.metaText || "15 seconds from the contribution song";
  const bits = [];
  if (it.views != null) bits.push(`${nf.format(it.views)} views`);
  if (it.duration && !it.short) bits.unshift(fmt(it.duration));
  if (it.published) bits.push(ago(it.published));
  return bits.join(" · ");
}
function thumbEl(it) {
  const box = el("div", { className: "th" });
  if (it.thumb) {
    const tall = it.shape === "tall";
    box.append(el("img", { src: it.thumb, alt: "", loading: "lazy", decoding: "async", width: tall ? 360 : 640, height: tall ? 640 : 360 }));
  }
  const len = it === CLIP ? "0:15" : it.duration ? fmt(it.duration) : it.short ? "Short" : "";
  if (len) box.append(el("span", { className: "badge", textContent: len }));
  return box;
}
const hrefFor = (it) => (it === CLIP ? "./" : "?v=" + encodeURIComponent(it.share));
function itemLink(it, sub) {
  const a = el("a", { href: hrefFor(it) }, thumbEl(it), el("div", {}, el("h3", { textContent: it.title }), el("p", { textContent: sub })));
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    load(it, { play: it.kind !== "youtube", focus: true });
  });
  return a;
}
function card(it) {
  const li = el("li", { className: "card" }, itemLink(it, metaLine(it)));
  li.dataset.key = it.key;
  return li;
}
let filter = "all", query = "";
const norm = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function renderLibrary() {
  const q = norm(query.trim());
  const match = (it) => !q || norm(it.title + " " + (it.description || "")).includes(q);
  const shorts = library.filter((it) => it.shape === "tall" && match(it));
  const vids = library.filter((it) => it.shape !== "tall" && match(it));
  const showS = filter !== "videos" && shorts.length > 0, showV = filter !== "shorts" && vids.length > 0;
  $("#shorts").replaceChildren(...(showS ? shorts.map(card) : []));
  $("#shorts-wrap").hidden = !showS;
  $("#grid").replaceChildren(...(showV ? vids.map(card) : []));
  $("#grid").hidden = !showV;
  $("#empty").hidden = showS || showV;
  $("#empty").textContent = q ? `Nothing matches “${query.trim()}”.` : library.length ? "Nothing here yet." : "The video list couldn't be loaded. Paste a link above to play anything.";
  markNow();
}
$$(".chips button").forEach((b) => b.addEventListener("click", () => {
  filter = b.dataset.f;
  $$(".chips button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  renderLibrary();
}));
$("#q").addEventListener("input", (e) => { query = e.target.value; renderLibrary(); });

let customQueue = null; // set once the viewer reorders Up next
function upNext() {
  if (!cur) return [];
  if (customQueue) return customQueue.filter((x) => x.key !== cur.key);
  const i = library.findIndex((x) => x.key === cur.key);
  return i < 0 ? library.slice() : [...library.slice(i + 1), ...library.slice(0, i)];
}
function renderQueue() {
  const list = upNext().slice(0, 8);
  $("#queue").replaceChildren(...list.map((it) => {
    const li = el("li", { className: "qi" }, itemLink(it, it === CLIP ? "Share clip" : metaLine(it)));
    li.dataset.key = it.key;
    li.append(el("button", { type: "button", className: "grip", ariaLabel: `Move “${it.title}” (arrow keys)`, innerHTML: '<svg aria-hidden="true"><use href="#i-grip"/></svg>' }));
    return li;
  }));
  $("#next").hidden = !list.length;
}
// videos YouTube refused to embed (error 150) are remembered on this device and labelled
function markYtOnly() {
  const l = store.get("ytonly", []);
  $$(".card, .qi").forEach((li) => li.classList.toggle("yt-only", li.dataset.key?.startsWith("yt:") && l.includes(li.dataset.key.slice(3))));
}
const playableHere = (it) => !(it.kind === "youtube" && store.get("ytonly", []).includes(it.id));
function markNow() {
  markYtOnly();
  $$(".card, .qi").forEach((li) => li.classList.toggle("now", !!cur && li.dataset.key === cur.key));
  $$(".card a[aria-current]").forEach((a) => a.removeAttribute("aria-current"));
  if (cur?.key) $$(".card").filter((li) => li.dataset.key === cur.key).forEach((li) => li.firstChild.setAttribute("aria-current", "true"));
}

/* ---------- player state ---------- */
let cur = null;        // item playing
let P = null;          // adapter for the current item
const prefs = {
  volume: store.get("volume", 1), muted: store.get("muted", false), rate: 1,
  autoplay: store.get("autoplay", true), theater: store.get("theater", false), remaining: store.get("remaining", false),
};
let loop = false;
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let dragging = false;
let blobUrl = null;

const setState = (cls, on) => stage.classList.toggle(cls, on);
function onPlay() { setState("paused", false); setState("ended", false); playBtn.setAttribute("aria-label", "Pause (k)"); bigPlay.setAttribute("aria-label", "Pause"); poke(); tick(); amb.kick(); mediaState(); }
function onPause() { setState("paused", true); playBtn.setAttribute("aria-label", "Play (k)"); bigPlay.setAttribute("aria-label", "Play"); poke(); paint(); amb.kick(); mediaState(); }
function onEnded() {
  setState("ended", true);
  onPause();
  if (extras.sleepAtEnd()) return;
  if (loop) { P.seek(0, true); P.play(); return; }
  const nxt = upNext().find(playableHere);
  if (prefs.autoplay && nxt && nxt.key !== cur.key) postPlay(nxt);
}
// Netflix-style post play: say what's next, count down, let the viewer cancel or skip ahead
let ppT = 0;
function postPlay(nxt) {
  const box = $("#postplay");
  $("#pp-title").textContent = nxt.title;
  box.hidden = false;
  box.classList.remove("run"); void box.offsetWidth; box.classList.add("run");
  clearTimeout(ppT);
  ppT = setTimeout(() => { box.hidden = true; if (stage.classList.contains("ended") && cur) load(nxt, { play: true }); }, 5000);
  $("#pp-play").onclick = () => { clearTimeout(ppT); box.hidden = true; load(nxt, { play: true }); };
  $("#pp-play").focus({ preventScroll: true });
}
function cancelPostPlay() { clearTimeout(ppT); $("#postplay").hidden = true; }
$("#pp-cancel").addEventListener("click", cancelPostPlay);
function onError(msg, link, label = "Open the link") {
  setState("error", true);
  setState("waiting", false);
  // nothing from the failed source should linger: time, progress, buffered, download
  lastText = ""; lastBuf = "";
  scrub.style.setProperty("--p", "0"); seek.value = "0";
  $("#cur").textContent = "0:00"; $("#dur").textContent = "0:00";
  $("#buffered").replaceChildren();
  $("#download").hidden = true;
  if ($("#title").textContent === "Loading…") setTitle(cur?.kind === "youtube" ? "YouTube video" : cur?.kind === "vimeo" ? "Vimeo video" : cur?.title || "Video");
  $("#notice-text").textContent = msg;
  const a = $("#notice-link");
  a.hidden = !link;
  if (link) { a.href = link; a.firstChild.textContent = label + " "; }
  $("#notice").hidden = false;
}
function clearError() { setState("error", false); $("#notice").hidden = true; }

/* ----- native adapter: files, HLS, DASH, local files ----- */
let hls = null, dash = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = el("script", { src, async: true });
    s.onload = res;
    s.onerror = () => rej(new Error("couldn't load " + src));
    document.head.append(s);
  });
}
function nativeAdapter(it) {
  const a = {
    native: true,
    play() { const p = video.play(); if (p) p.catch((e) => { if (e.name === "NotAllowedError") onPause(); }); },
    pause() { video.pause(); },
    seek(t) { if (isFinite(t)) video.currentTime = a.d > 0 ? clamp(t, 0, a.d - 0.05) : Math.max(0, t); },
    get t() { return video.currentTime || 0; },
    get d() { return isFinite(video.duration) ? video.duration : video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : 0; },
    get paused() { return video.paused; },
    setVol(v, m) { video.volume = v; video.muted = m; },
    setRate(r) { video.playbackRate = r; },
    setLoop(l) { video.loop = l; },
    rates: () => RATES,
    buffered() { const out = [], b = video.buffered; for (let i = 0; i < b.length; i++) out.push([b.start(i), b.end(i)]); return out; },
    destroy() {},
  };
  const src = it.src;
  const mse = !!(window.MediaSource || window.ManagedMediaSource);
  setState("waiting", true);
  if (it.thumb) video.poster = it.thumb; else video.removeAttribute("poster");
  if (it.kind === "hls" && (!mse || (video.canPlayType("application/vnd.apple.mpegurl") && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent)))) {
    video.src = src; // Safari plays HLS natively
  } else if (it.kind === "hls") {
    (window.Hls ? Promise.resolve() : loadScript("vendor/hls.light.min.js")).then(() => {
      if (P !== a) return;
      const Hls = window.Hls;
      if (!Hls.isSupported()) { if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = src; return; } return onError("This browser can't play HLS streams."); }
      hls = new Hls({ enableWorker: true, backBufferLength: 60 });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        onError(d.type === Hls.ErrorTypes.NETWORK_ERROR ? "The stream couldn't be loaded. The server may not let other sites play it, or the link has expired." : "This stream couldn't be played.", src);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    }).catch(() => onError("The HLS player couldn't be loaded."));
  } else if (it.kind === "dash") {
    (window.dashjs ? Promise.resolve() : loadScript("vendor/dash.mediaplayer.min.js")).then(() => {
      if (P !== a) return;
      const dj = window.dashjs;
      if (!(window.MediaSource || window.ManagedMediaSource || window.WebKitMediaSource)) return onError("This browser can't play DASH streams.");
      dash = dj.MediaPlayer().create();
      dash.updateSettings({ debug: { logLevel: 1 } });
      dash.on(dj.MediaPlayer.events.ERROR, () => onError("The DASH stream couldn't be loaded. The server may not let other sites play it, or the format isn't supported.", src));
      dash.initialize(video, src, false);
    }).catch(() => onError("The DASH player couldn't be loaded."));
  } else {
    video.src = src;
  }
  return a;
}
function teardownNative() {
  if (hls) { hls.destroy(); hls = null; }
  if (dash) { try { dash.reset(); } catch {} dash = null; }
  video.pause();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  video.removeAttribute("src");
  video.removeAttribute("poster");
  video.load();
}
video.addEventListener("play", () => P?.native && onPlay());
video.addEventListener("pause", () => P?.native && onPause());
video.addEventListener("ended", () => P?.native && !video.loop && onEnded());
video.addEventListener("waiting", () => P?.native && setState("waiting", true));
video.addEventListener("playing", () => { setState("waiting", false); clearError(); });
video.addEventListener("canplay", () => setState("waiting", false));
video.addEventListener("loadedmetadata", () => {
  if (!P?.native) return;
  setState("waiting", false);
  if (video.videoWidth && video.videoHeight) setShape(video.videoHeight > video.videoWidth * 1.05 ? "tall" : "wide");
  P.setRate(prefs.rate);
  if (cur?.start) P.seek(cur.start); else resumeCheck();
  captionsCheck();
  paint();
  amb.kick();
});
video.addEventListener("timeupdate", () => { if (P?.native && video.paused) paint(); savePos(); });
video.addEventListener("progress", () => P?.native && paintBuffered());
video.addEventListener("ratechange", () => { if (P?.native) { prefs.rate = video.playbackRate; syncRateUI(); } });
video.addEventListener("error", () => {
  if (!P?.native || hls || dash || !video.getAttribute("src")) return;
  const code = video.error?.code, it = cur;
  let msg = "This video couldn't be played.";
  if (it?.local) msg = "This browser can't play that file. MP4 (H.264) and WebM play almost everywhere; MKV and some MOV files only play in some browsers.";
  else if (code === 4) msg = it?.via ? `${it.via} didn't hand over the video file. Make sure the link is shared with anyone who has it, or download the file and play it from your device.` : it?.guessed ? "This link didn't load as a video. It's probably a web page rather than a video file. Open the page, right-click the video and copy its address, or paste a link from a supported site." : "The video couldn't be loaded. The link may be broken or expired, the server may block other sites, or the format isn't one this browser plays (MP4 and WebM are the safest).";
  else if (code === 2 && it?.via) msg = `${it.via} didn't hand over the video file. Make sure the link is shared with anyone who has it.`;
  else if (code === 2) msg = "The video couldn't be downloaded. Check the link; the server may also be blocking other sites.";
  onError(msg, it?.local ? null : it?.src);
  if (!it?.local && code === 4 && !it?.guessed && !it?.via) {
    fetch(it.src, { method: "HEAD", mode: "cors", credentials: "omit" }).then((r) => {
      if (cur !== it) return;
      if (r.status >= 400) onError(r.status === 404 || r.status === 410 ? "That file isn't there any more (the server says it's missing). The link may be old." : r.status === 401 || r.status === 403 ? "The server won't hand over this file. It may need a login, or the link has expired." : `The server answered with an error (${r.status}).`, it.src);
    }).catch(() => {
      if (cur === it) onError("The video couldn't be loaded. The link may be broken or expired, the server may block other sites, or the format isn't one this browser plays (MP4 and WebM are the safest).", it.src);
    });
  }
});

/* ----- YouTube adapter (IFrame Player API, privacy-enhanced host) ----- */
let ytApi = null;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  return (ytApi ||= new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = el("script", { src: "https://www.youtube.com/iframe_api", async: true });
    s.onerror = () => { ytApi = null; rej(new Error("api")); };
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) { ytApi = null; rej(new Error("timeout")); } }, 20000);
  }));
}
// only the flags this browser knows (WebKit warns about allow-presentation)
const SANDBOX = (() => {
  const want = ["allow-scripts", "allow-same-origin", "allow-presentation", "allow-popups", "allow-popups-to-escape-sandbox"];
  const t = document.createElement("iframe").sandbox;
  return want.filter((f) => !t?.supports || t.supports(f)).join(" ");
})();
function frame(src, title, extraAllow = "") {
  const f = el("iframe", { src, title });
  f.setAttribute("sandbox", SANDBOX);
  f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen" + extraAllow);
  f.setAttribute("allowfullscreen", "");
  f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  return f;
}
function ytSrc(it, mirror = false) {
  const q = new URLSearchParams({
    enablejsapi: "1", controls: "0", rel: "0", playsinline: "1",
    iv_load_policy: "3", disablekb: "1", fs: "0",
  });
  // origin must be the real https origin (https://nishal21.github.io on Pages); a file:// page has none
  if (/^https?:$/.test(location.protocol)) { q.set("origin", location.origin); q.set("widget_referrer", SITE.href); }
  if (mirror) { q.set("mute", "1"); q.set("cc_load_policy", "0"); }
  else {
    // captions only when the viewer turned them on here; never forced by the video
    const on = store.get("captions", false), lang = store.get("capLang", "");
    q.set("cc_load_policy", on ? "1" : "0");
    if (on && lang) q.set("cc_lang_pref", lang);
  }
  if (it.start) q.set("start", String(Math.floor(it.start)));
  if (it.list && !mirror) q.set("list", it.list);
  return `https://www.youtube-nocookie.com/embed/${it.id || "videoseries"}?${q}`;
}
function ytErrorText(code) {
  if (code === 101 || code === 150) return "YouTube only plays this one on youtube.com. That usually means the music in it is licensed for YouTube alone.";
  if (code === 100) return "This video was removed, made private, or never existed.";
  if (code === 153) return "YouTube needs to know which website is showing it, and this page didn't say. That happens when the page is opened as a saved file; it works on the live site.";
  if (code === 2) return "That YouTube link has an invalid video ID.";
  if (code === 5) return "YouTube's player couldn't play this video in this browser.";
  return "YouTube couldn't play this video.";
}
// file:// pages have no origin, so YouTube (error 153), Vimeo and Twitch embeds can't work there
const servedFromWeb = /^https?:$/.test(location.protocol);
function ytAdapter(it) {
  const f = frame(ytSrc(it), it.title ? `YouTube: ${it.title}` : "YouTube video");
  embedBox.append(f);
  let yt = null, ready = false, state = -1, poll = 0;
  const a = {
    yt: true,
    play() { ready && yt.playVideo(); },
    pause() { ready && yt.pauseVideo(); },
    seek(t, final = true) { if (ready) yt.seekTo(Math.max(0, t), final); },
    get t() { return ready ? yt.getCurrentTime?.() || 0 : 0; },
    get d() { return ready ? yt.getDuration?.() || 0 : 0; },
    get paused() { return state !== 1 && state !== 3; },
    get state() { return state; },
    setVol(v, m) { if (!ready) return; yt.setVolume(Math.round(v * 100)); m ? yt.mute() : yt.unMute(); },
    setRate(r) { ready && yt.setPlaybackRate(r); },
    setLoop(l) { ready && it.list && yt.setLoop(l); },
    rates: () => (ready && yt.getAvailablePlaybackRates?.()) || [1],
    buffered() { return ready ? [[0, (yt.getVideoLoadedFraction?.() || 0) * a.d]] : []; },
    next() { if (ready && it.list) { yt.nextVideo(); return true; } return false; },
    destroy() { clearInterval(poll); clearTimeout(capT); try { yt?.destroy(); } catch {} },
    caps: {
      list() { return raw().map((t) => ({ id: t.languageCode, label: t.displayName || t.languageName || t.languageCode })); },
      // YouTube reports the old track for a while after a switch, so remember what was picked
      current() { return capCur; },
      apply,
    },
  };
  // off unloads YouTube's caption module (which is what actually hides them); on loads it and picks a track
  let capT = 0, capCur = "";
  function raw() { try { return (yt.getOption("captions", "tracklist") || []).filter((t) => t && t.languageCode); } catch { return []; } }
  function apply(pick) {
    if (!ready) return;
    clearTimeout(capT);
    if (!store.get("captions", false)) {
      capCur = "";
      try { yt.unloadModule("captions"); } catch {}
      return;
    }
    try { yt.loadModule("captions"); } catch {}
    let tries = 0;
    // the module takes a moment to load; a track set before that is ignored
    const choose = () => {
      const list = raw();
      if (!list.length || !(yt.getOptions?.() || []).includes("captions")) {
        if (++tries < 16) capT = setTimeout(choose, 250);
        else if (pick !== undefined) { toast("This video has no captions."); store.set("captions", false); apply(); syncCC(); }
        return;
      }
      const want = pick || store.get("capLang", "");
      const t = list.find((x) => x.languageCode === want) || list.find((x) => want && x.languageCode.split("-")[0] === want.split("-")[0]) || list.find((x) => x.languageCode.startsWith((navigator.language || "en").split("-")[0])) || list[0];
      try { yt.setOption("captions", "track", t); } catch {}
      capCur = t.languageCode;
      syncCC();
    };
    capT = setTimeout(choose, 300);
  }
  setState("waiting", true);
  loadYT().then(() => {
    if (P !== a) return;
    yt = new window.YT.Player(f, {
      events: {
        onReady() {
          ready = true;
          setState("waiting", false);
          a.setVol(prefs.volume, prefs.muted);
          poll = setInterval(() => { if (P === a) { if (a.paused) paint(); paintBuffered(); } }, 500);
          const data = yt.getVideoData?.();
          if (data?.title && !it.title) setTitle(data.title, data.author);
          paint();
          if (it.autoplay) yt.playVideo();
          syncCC();
        },
        // YouTube loads its caption module by itself when a video starts; keep it in line with the choice
        onApiChange() { if (!store.get("captions", false)) apply(); },
        onStateChange(e) {
          state = e.data;
          if (state === 1) {
            setState("started", true);
            setState("waiting", false);
            clearError();
            const data = yt.getVideoData?.();
            if (data?.title && (it.list || !it.title)) setTitle(data.title, data.author);
            if (prefs.rate !== 1) yt.setPlaybackRate(prefs.rate);
            if (!store.get("captions", false)) apply();
            onPlay();
          } else if (state === 2 || state === 5 || state === -1) { setState("waiting", false); onPause(); }
          else if (state === 3) setState("waiting", true);
          else if (state === 0) onEnded();
          amb.sync();
        },
        onPlaybackRateChange(e) { prefs.rate = e.data; syncRateUI(); amb.sync(); },
        onError(e) {
          if ((e.data === 101 || e.data === 150) && it.id) { const l = store.get("ytonly", []); if (!l.includes(it.id)) store.set("ytonly", [...l, it.id].slice(-200)); markYtOnly(); }
          embedBox.replaceChildren(); // our message instead of YouTube's own error screen
          onError(ytErrorText(e.data), it.href || it.src, "Watch on YouTube");
        },
        onAutoplayBlocked() { onPause(); },
      },
    });
  }).catch(() => onError("YouTube's player couldn't be loaded. A content blocker or the network may be stopping it.", it.href || it.src));
  return a;
}

/* ----- Vimeo adapter (postMessage player API; Vimeo keeps its own controls) ----- */
const VIMEO = "https://player.vimeo.com";
function vimeoSrc(it, mirror = false) {
  // controls=0 hides Vimeo's own UI so ours can sit on top (Vimeo honours it on paid accounts' videos)
  const q = new URLSearchParams({ dnt: "1", playsinline: "1", title: "0", byline: "0", portrait: "0", badge: "0", autopause: "0", controls: "0", keyboard: "0", pip: "0", vimeo_logo: "0" });
  if (it.hash) q.set("h", it.hash);
  q.set("speed", "1");
  if (mirror) { q.set("muted", "1"); q.set("quality", "240p"); }
  return `${VIMEO}/video/${it.id}?${q}${it.start ? `#t=${Math.floor(it.start)}s` : ""}`;
}
const vimeoPost = (f, method, value) => f.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), VIMEO);
function vimeoListen(f, handler) {
  const on = (e) => {
    if (e.origin !== VIMEO || e.source !== f.contentWindow) return;
    let m = e.data;
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { return; } }
    if (!m || typeof m !== "object") return;
    // the embed answers with its older event names: playProgress, loadProgress, seek, finish
    const alias = { playProgress: "timeupdate", loadProgress: "progress", seek: "seeked", finish: "ended" };
    if (alias[m.event]) m = { ...m, event: alias[m.event] };
    if (m.event === "ready") for (const ev of ["play", "pause", "ended", "timeupdate", "progress", "playbackratechange", "seeked", "bufferstart", "bufferend", "texttrackchange", "loaded", "error"]) vimeoPost(f, "addEventListener", ev);
    handler(m);
  };
  addEventListener("message", on);
  return () => removeEventListener("message", on);
}
function vimeoAdapter(it) {
  const f = frame(vimeoSrc(it), it.title ? `Vimeo: ${it.title}` : "Vimeo video");
  embedBox.append(f);
  let t = 0, tAt = 0, d = 0, paused = true, loaded = 0, buffering = false, ended = false, rate = 1, speedOk = true, tracks = [], track = "", wantPlay = -1e9, retried = false;
  const applyCaps = (pick) => {
    const on = store.get("captions", false);
    if (!on) { vimeoPost(f, "disableTextTrack"); track = ""; return; }
    if (!tracks.length) { if (pick !== undefined) { toast("This video has no captions."); store.set("captions", false); syncCC(); } return; }
    const want = pick || store.get("capLang", "");
    const tr = tracks.find((x) => x.language === want) || tracks.find((x) => want && x.language.split("-")[0] === want.split("-")[0]) || tracks[0];
    vimeoPost(f, "enableTextTrack", { language: tr.language, kind: tr.kind });
  };
  const off = vimeoListen(f, (m) => {
    const data = m.data || {};
    if (m.event === "ready") {
      setState("waiting", false);
      vimeoPost(f, "setVolume", prefs.muted ? 0 : prefs.volume);
      vimeoPost(f, "getDuration"); vimeoPost(f, "getTextTracks");
      if (prefs.rate !== 1) vimeoPost(f, "setPlaybackRate", prefs.rate);
    }
    else if (m.event === "loaded") { vimeoPost(f, "getTextTracks"); }
    else if (m.method === "getDuration" && isFinite(m.value)) { d = +m.value; paint(); }
    else if (m.method === "getTextTracks" && Array.isArray(m.value)) {
      tracks = m.value.filter((x) => x && x.language).map((x) => ({ language: x.language, kind: x.kind || "subtitles", label: x.label || x.language }));
      track = (m.value.find((x) => x.mode === "showing") || {}).language || "";
      applyCaps(); syncCC();
    }
    else if (m.event === "texttrackchange") { track = data.language || ""; syncCC(); }
    // speed changes only work on videos from paid Vimeo accounts; say so once and stay at 1×
    else if (m.event === "error" && data.method === "setPlaybackRate") {
      speedOk = false; prefs.rate = 1; syncRateUI();
      if (P === a) toast("The owner of this Vimeo video hasn't allowed speed changes.");
    }
    else if (m.event === "error" && data.method === "play") { paused = true; onPause(); }
    // the first play sometimes fails while Vimeo's stream starts up; one quiet retry fixes it
    else if (m.event === "error" && data.name === "PlaybackError" && paused && performance.now() - wantPlay < 4000 && !retried) { retried = true; setTimeout(() => { if (paused) vimeoPost(f, "play"); }, 700); }
    else if (m.event === "timeupdate") { t = data.seconds || 0; tAt = performance.now(); d = data.duration || d; }
    else if (m.event === "progress") loaded = data.percent || 0;
    else if (m.event === "play") { paused = false; ended = false; tAt = performance.now(); onPlay(); }
    else if (m.event === "pause") { paused = true; onPause(); }
    else if (m.event === "ended") { paused = true; ended = true; onEnded(); }
    else if (m.event === "seeked") { t = data.seconds ?? t; tAt = performance.now(); amb.sync(); }
    else if (m.event === "bufferstart") { buffering = true; amb.sync(); }
    else if (m.event === "bufferend") { buffering = false; tAt = performance.now(); amb.sync(); }
    else if (m.event === "playbackratechange") { prefs.rate = rate = data.playbackRate || 1; amb.sync(); }
    // Vimeo keeps its own controls and shows its own error screens, so its errors never cover the player here;
    // only a privacy refusal gets a short note (PlaybackError is often transient and Vimeo retries itself)
    else if (m.event === "error" && !data.method && /Privacy|NotFound|Password/.test(data.name || "")) toast("Vimeo says this video is private or can't be shown on other sites.");
  });
  setState("waiting", true);
  setTimeout(() => setState("waiting", false), 4000);
  const a = {
    vimeo: true,
    play() { wantPlay = performance.now(); vimeoPost(f, "play"); }, pause() { vimeoPost(f, "pause"); },
    seek(x) { t = clamp(x, 0, d || x); tAt = performance.now(); ended = false; vimeoPost(f, "setCurrentTime", t); },
    // timeupdate arrives about four times a second; between those the clock is carried forward
    get t() { return paused || buffering || !tAt ? t : Math.min(d || Infinity, t + ((performance.now() - tAt) / 1000) * rate); },
    get d() { return d; }, get paused() { return paused; }, get buffering() { return buffering; }, get ended() { return ended; },
    setVol(v, m) { vimeoPost(f, "setVolume", m ? 0 : v); },
    setRate(r) { if (speedOk) vimeoPost(f, "setPlaybackRate", r); },
    setLoop(l) { vimeoPost(f, "setLoop", l); },
    rates: () => (speedOk ? RATES : [1]), buffered: () => [[0, loaded * d]],
    set speedOk(v) { speedOk = v; },
    destroy() { off(); },
    caps: {
      list: () => tracks.map((x) => ({ id: x.language, label: x.label })),
      current: () => track,
      apply: applyCaps,
    },
  };
  return a;
}

/* ----- other sites: their own player in a sandboxed frame ----- */
function embedAdapter(it) {
  embedBox.append(frame(it.embed, `${it.provider} video`, "; clipboard-write"));
  return { embed: true, play() {}, pause() {}, seek() {}, t: 0, d: 0, paused: true, setVol() {}, setRate() {}, setLoop() {}, rates: () => [1], buffered: () => [], destroy() {} };
}

/* ---------- load an item ---------- */
function setShape(s) { stage.dataset.shape = s; glowBox.dataset.shape = s; fitYT(); }
/* YouTube draws its own title bar along the top and a "More videos" strip along the bottom whenever the video
   is paused, and the embed API has no switch for them. The frame is made taller than the stage, with the picture
   exactly filling it, so those bars land in the part the stage clips off. The picture itself isn't cropped. */
function fitYT() {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const a = stage.dataset.shape === "tall" ? 9 / 16 : 16 / 9;
  const vw = Math.min(W, H * a), vh = vw / a;
  stage.style.setProperty("--yt-w", vw.toFixed(1) + "px");
  stage.style.setProperty("--yt-h", vh.toFixed(1) + "px");
  stage.style.setProperty("--yt-cut", clamp(Math.round(vh * 0.16), 56, 140) + "px");
}
if ("ResizeObserver" in window) new ResizeObserver(fitYT).observe(stage); else addEventListener("resize", fitYT);
function setTitle(title, author) {
  $("#title").textContent = title;
  if (cur && !cur.title) cur.title = title;
  if (author && cur && cur.views == null) $("#meta").textContent = author;
  document.title = `${title} · Nishal K`;
  mediaMeta();
}
function updateInfo(it) {
  $("#eyebrow").textContent = it.eyebrow || "";
  $("#title").textContent = it.title || "Loading…";
  const meta = $("#meta");
  meta.replaceChildren();
  if (it.kind === "youtube" && it.views != null) meta.append(el("a", { href: channel.url, textContent: channel.name || channel.handle }), " · " + metaLine(it));
  else meta.textContent = it === CLIP ? metaLine(it) : it.metaText || "";
  const dl = $("#download");
  dl.hidden = !it.download;
  if (it.download) { dl.href = it.download.href; dl.download = it.download.name || ""; $("span", dl).textContent = it.download.label || "Download"; }
  const open = $("#open");
  open.hidden = !it.href;
  if (it.href) { open.href = it.href; $("span", open).textContent = it.openLabel || "Open original"; }
  // local files are never shareable: nothing about them goes into a link, the address bar or history
  $("#share").hidden = false;
  $("#share").setAttribute("aria-disabled", String(!!it.local));
  $("#share").title = it.local ? "Local files stay on your device" : "";
  const desc = $("#desc");
  desc.hidden = !it.description;
  desc.open = false;
  if (it.description) linkify($("#desc-text"), it.description);
  document.title = `${it.title || "Video"} · Nishal K`;
}
function linkify(p, text) {
  p.replaceChildren();
  for (const part of text.split(/(https?:\/\/[^\s)]+)/g)) {
    if (/^https?:\/\//.test(part)) p.append(el("a", { href: part, textContent: part, rel: "noopener noreferrer nofollow", target: "_blank" }));
    else p.append(part);
  }
}
function itemFromParsed(x) {
  const it = { ...x };
  if (x.kind === "youtube") {
    const known = x.id && !x.list && library.find((l) => l.id === x.id);
    if (known) return x.start ? { ...known, start: x.start } : known;
    Object.assign(it, {
      key: "yt:" + (x.id || x.list), shape: x.short ? "tall" : "wide", eyebrow: x.list ? "YouTube playlist" : x.short ? "YouTube Short" : "YouTube",
      title: "", thumb: x.id ? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg` : "", remoteThumb: true,
      href: x.src, openLabel: "Open on YouTube", share: x.id && !x.list ? x.id : x.src,
    });
  } else if (x.kind === "vimeo") {
    Object.assign(it, { key: "vimeo:" + x.id, shape: "wide", eyebrow: "Vimeo", title: "", href: x.src, openLabel: "Open on Vimeo", share: x.src });
  } else if (x.kind === "external") {
    Object.assign(it, { key: "ext:" + x.src, eyebrow: x.provider, title: `${x.provider} post`, href: x.src, openLabel: `Open on ${x.provider}`, share: x.src, metaText: `Plays in the ${x.provider} app or site` });
  } else if (x.kind === "embed") {
    Object.assign(it, { key: x.embed, eyebrow: x.provider, title: `${x.provider} video`, href: x.src, openLabel: `Open on ${x.provider}`, share: x.src, metaText: `Plays in ${x.provider}'s own player`, remoteThumb: true });
  } else {
    const u = new URL(x.src);
    Object.assign(it, {
      key: x.src, shape: "wide", eyebrow: x.via ? `From ${x.via}` : x.kind === "hls" ? "HLS stream" : x.kind === "dash" ? "DASH stream" : "Video file",
      title: x.title || "Video", metaText: u.hostname, share: x.src, href: x.src, openLabel: "Open the file",
      download: x.kind === "file" ? { href: x.src, name: x.title, label: "Download", remote: u.origin !== location.origin } : null,
    });
  }
  return it;
}

let loadSeq = 0;
function load(it, { play = false, push = true, focus = false } = {}) {
  const seq = ++loadSeq;
  savePos(true);
  P?.destroy();
  P = null;
  teardownNative();
  embedBox.replaceChildren();
  amb.stopMirror();
  if (blobUrl && it.src !== blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  closeMenus();
  clearError();
  $("#resume").hidden = true;
  cancelPostPlay();
  for (const c of ["started", "ended", "waiting", "idle"]) setState(c, false);
  setState("paused", true);
  lastBuf = "";
  $("#buffered").replaceChildren();
  pv.removeAttribute("src"); pv.dataset.src = "";

  cur = it;
  stage.dataset.kind = it.kind === "hls" || it.kind === "dash" ? "file" : it.kind;
  setShape(it.shape || "wide");
  loop = !!it.loop;
  updateInfo(it);
  applyAccent(it.colors?.[1] || it.colors?.[0] || null);
  it.autoplay = play;
  const external = it.kind === "external";
  const needsWeb = !external && !servedFromWeb && (it.kind === "youtube" || it.kind === "vimeo" || it.provider === "Twitch");
  if (needsWeb || external) P = { embed: true, play() {}, pause() {}, seek() {}, t: 0, d: 0, paused: true, setVol() {}, setRate() {}, setLoop() {}, rates: () => [1], buffered: () => [], destroy() {} };
  else if (it.kind === "youtube") P = ytAdapter(it);
  else if (it.kind === "vimeo") P = vimeoAdapter(it);
  else if (it.kind === "embed") P = embedAdapter(it);
  else P = nativeAdapter(it);
  P.setVol(prefs.volume, prefs.muted);
  P.setLoop(loop);
  syncToggles();
  syncCC();
  amb.setSource(it);
  extras.onLoad(it);
  if (it.kind === "vimeo") vimeoOembed(it, seq);
  try {
  if (it.local) {
    if (location.search) history.replaceState(null, "", SITE);
  } else if (push) {
    const url = new URL(SITE);
    if (it !== CLIP && it.share) url.searchParams.set("v", it.share);
    if (it.start) url.searchParams.set("t", String(Math.floor(it.start)));
    if (url.href !== location.href) history.pushState(null, "", url);
  }
  } catch {} // file:// pages can't change their address; playback doesn't depend on it
  renderQueue();
  markNow();
  mediaMeta();
  paint();
  // a provider that never reports a title still gets a sensible one
  setTimeout(() => { if (seq === loadSeq && $("#title").textContent === "Loading…") setTitle(it.kind === "youtube" ? "YouTube video" : it.kind === "vimeo" ? "Vimeo video" : "Video"); }, 6000);
  if (external) {
    setState("calm", true);
    onError(`${it.provider} videos only play in ${it.provider}'s own app or site.`, it.href, `Open on ${it.provider}`);
  } else setState("calm", false);
  if (needsWeb) {
    const name = it.kind === "youtube" ? "YouTube" : it.kind === "vimeo" ? "Vimeo" : "Twitch";
    onError(`${name} needs the page to be served from a website, so it can't play in a saved copy of this page. It works on the live site.`, it.href || it.src, `Watch on ${name}`);
  }
  if (play && P.native) P.play();
  if (focus) {
    stage.focus({ preventScroll: true });
    const r = stage.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) stage.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
}
async function vimeoOembed(it, seq) {
  try {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${it.id}${it.hash ? "/" + it.hash : ""}`)}&width=640`);
    if (!r.ok || seq !== loadSeq) return;
    const o = await r.json();
    if (seq !== loadSeq) return;
    if (typeof o.title === "string") { it.title = o.title; setTitle(o.title); }
    if (typeof o.author_name === "string") $("#meta").textContent = o.author_name;
    if (typeof o.thumbnail_url === "string" && /^https:\/\/i\.vimeocdn\.com\//.test(o.thumbnail_url)) { it.thumb = o.thumbnail_url; it.remoteThumb = true; amb.updateStills(it); mediaMeta(); }
    if (o.width && o.height) setShape(o.height > o.width * 1.05 ? "tall" : "wide");
    // controls=0 and speed only work on videos from paid Vimeo plans; free ones keep a little Vimeo UI
    if (/^(basic|free)$/i.test(o.account_type || "") && cur === it) {
      if (P?.vimeo) P.speedOk = false;
      stage.classList.add("vimeo-free");
      toast("This Vimeo video comes from a free account, so Vimeo shows a little of its own player. These controls still work.");
    }
  } catch {}
}

/* ---------- painting the controls ---------- */
let raf = 0;
function tick() {
  cancelAnimationFrame(raf);
  const step = () => { paint(); if (P && !P.paused) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}
let lastText = "";
function paint() {
  if (!P) return;
  const d = P.d, t = dragging ? (seek.value / 1000) * d : P.t;
  const p = d ? clamp(t / d, 0, 1) : 0;
  scrub.style.setProperty("--p", p.toFixed(4));
  if (!dragging) seek.value = String(Math.round(p * 1000));
  const txt = (prefs.remaining && d ? "-" + fmt(d - t) : fmt(t)) + "|" + fmt(d);
  if (txt !== lastText) {
    lastText = txt;
    const [a, b] = txt.split("|");
    $("#cur").textContent = a;
    $("#dur").textContent = b;
    seek.setAttribute("aria-valuetext", `${fmt(t)} of ${fmt(d)}`);
  }
}
let lastBuf = "";
function paintBuffered() {
  if (!P) return;
  const d = P.d;
  const ranges = d ? P.buffered() : [];
  const sig = ranges.map((r) => r.map((x) => x.toFixed(1)).join("-")).join(",");
  if (sig === lastBuf) return;
  lastBuf = sig;
  $("#buffered").replaceChildren(...ranges.map(([s, e]) => {
    const i = el("i");
    i.style.left = (100 * s / d).toFixed(2) + "%";
    i.style.width = (100 * (e - s) / d).toFixed(2) + "%";
    return i;
  }));
}

/* ---------- actions ---------- */
function toggle() {
  if (!P || P.embed) return;
  if (stage.classList.contains("ended") && !loop) { P.seek(0, true); P.play(); return; }
  P.paused ? P.play() : P.pause();
}
function seekTo(t) {
  if (!P || P.embed || !P.d) return;
  P.seek(clamp(t, 0, P.d), true);
  setState("ended", false);
  amb.seeked(clamp(t, 0, P.d));
  paint();
}
const seekBy = (s) => P && seekTo(P.t + s);
function setVolume(v, m = prefs.muted) {
  prefs.volume = clamp(v, 0, 1);
  prefs.muted = m;
  P?.setVol(prefs.volume, prefs.muted);
  store.set("volume", prefs.volume);
  store.set("muted", prefs.muted);
  syncVolUI();
}
function syncVolUI() {
  const v = prefs.muted ? 0 : prefs.volume;
  $("#volume").value = String(Math.round(v * 100));
  $("#volume").setAttribute("aria-valuetext", prefs.muted ? "Muted" : `${Math.round(v * 100)}%`);
  $("#mute").dataset.level = v === 0 ? "0" : v < 0.5 ? "1" : "2";
  $("#mute").setAttribute("aria-label", v === 0 ? "Unmute (m)" : "Mute (m)");
}
function nearest(list, r) { return list.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), list[0] ?? 1); }
function setRate(r) {
  const allowed = P?.rates() || RATES;
  prefs.rate = allowed.includes(r) ? r : nearest(allowed, r);
  P?.setRate(prefs.rate);
  syncRateUI();
}
function stepRate(dir) {
  const allowed = (P?.rates() || RATES).filter((x) => x >= 0.25);
  const i = allowed.indexOf(nearest(allowed, prefs.rate));
  setRate(allowed[clamp(i + dir, 0, allowed.length - 1)]);
  bezel(`${prefs.rate}×`);
}
function syncRateUI() {
  const tag = $("#rate-tag");
  tag.hidden = prefs.rate === 1;
  tag.textContent = prefs.rate + "×";
  $$("#speeds button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.r === prefs.rate)));
}
function setLoop(l) { loop = l; P?.setLoop(l); syncToggles(); }
function setTheater(on) { prefs.theater = on; store.set("theater", on); syncToggles(); amb.refresh(); }
function syncToggles() {
  $("#loop-btn").setAttribute("aria-pressed", String(loop));
  $("#m-loop").setAttribute("aria-checked", String(loop));
  for (const b of [$("#m-autoplay"), $("#autoplay")]) b.setAttribute("aria-checked", String(prefs.autoplay));
  $("#theater").setAttribute("aria-pressed", String(prefs.theater));
  document.body.classList.toggle("theater", prefs.theater);
  const pipOk = !!P?.native && document.pictureInPictureEnabled !== false && ("requestPictureInPicture" in video || "webkitSetPresentationMode" in video);
  $("#pip").hidden = !pipOk;
}
function nextItem() {
  if (P?.next?.()) return;
  const n = upNext()[0];
  if (n) load(n, { play: n.kind !== "youtube" || stage.classList.contains("started") });
}

/* fullscreen, with orientation for phones and fallbacks for iPhone */
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFS() {
  if (fsEl()) { const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); r?.catch?.(() => {}); return; }
  if (stage.classList.contains("pseudo-fs")) { pseudoFS(false); return; }
  const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (req && document.fullscreenEnabled !== false) {
    try {
      const r = req.call(stage, { navigationUI: "hide" });
      if (r?.then) r.then(lockOrientation).catch(fallbackFS); else lockOrientation();
    } catch { fallbackFS(); }
  } else fallbackFS();
}
function fallbackFS() {
  if (P?.native && video.webkitEnterFullscreen && video.readyState > 0) video.webkitEnterFullscreen();
  else pseudoFS(true);
}
function pseudoFS(on) {
  stage.classList.toggle("pseudo-fs", on);
  document.documentElement.style.overflow = on ? "hidden" : "";
  $("#fs").setAttribute("aria-label", on ? "Exit full screen (f)" : "Full screen (f)");
}
function lockOrientation() {
  if (!coarse.matches || !screen.orientation?.lock) return;
  screen.orientation.lock(stage.dataset.shape === "tall" ? "portrait" : "landscape").catch(() => {});
}
for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, () => {
  const on = !!fsEl();
  $("#fs").setAttribute("aria-label", on ? "Exit full screen (f)" : "Full screen (f)");
  if (!on) try { screen.orientation?.unlock?.(); } catch {}
  poke();
});
async function togglePiP() {
  if (!P?.native) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
  } catch { toast("Picture in picture isn't available right now."); }
}
const textTracks = () => [...video.textTracks].filter((t) => t.kind === "subtitles" || t.kind === "captions");
/* Captions are off unless the viewer turns them on; the choice and the language carry across videos.
   Files use their text tracks; YouTube and Vimeo go through their player APIs. */
function capTracks() {
  if (P?.caps) return P.caps.list();
  return textTracks().map((t, i) => ({ id: String(i), label: t.label || t.language || `Track ${i + 1}`, lang: t.language }));
}
function nativeCaps(pickIdx) {
  const tracks = textTracks(), on = store.get("captions", false), lang = store.get("capLang", "");
  let i = pickIdx ?? tracks.findIndex((t) => lang && t.language === lang);
  if (i < 0) i = 0;
  tracks.forEach((t, k) => (t.mode = on && k === i ? "showing" : "hidden"));
}
function captionsCheck() { nativeCaps(); syncCC(); }
function syncCC() {
  const on = store.get("captions", false);
  const ext = P?.yt || P?.vimeo;
  const n = capTracks().length;
  $("#cc").hidden = !(ext || n);
  $("#cc").setAttribute("aria-pressed", String(on && (P?.yt || n > 0)));
  $("#m-subs-state").textContent = (on && (P?.yt || n > 0) ? "On" : "Off") + " ›";
  renderCapList();
}
function setCaptions(on, id) {
  store.set("captions", on);
  if (on && id != null) {
    const t = capTracks().find((x) => x.id === id);
    store.set("capLang", t?.lang || (P?.caps ? id : "") || store.get("capLang", ""));
  }
  if (P?.caps) P.caps.apply(id ?? null);
  else nativeCaps(id != null ? +id : undefined);
  syncCC();
}
function toggleCaptions() {
  if (!P?.caps && !textTracks().length) { bezel("No captions"); return; }
  const on = !store.get("captions", false);
  setCaptions(on);
  bezel(on ? "Captions on" : "Captions off");
}
// the track list in the Subtitles panel: Off plus every track the video has
function renderCapList() {
  const box = $("#cap-list");
  if (!box) return;
  const list = capTracks(), on = store.get("captions", false);
  const now = P?.caps ? P.caps.current() : String(textTracks().findIndex((t) => t.mode === "showing"));
  box.hidden = !list.length && !P?.caps;
  const row = (label, checked, fn) => {
    const b = el("button", { type: "button", className: "menu-row", textContent: label });
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", String(checked));
    b.addEventListener("click", fn);
    return b;
  };
  box.replaceChildren(
    row("Off", !on, () => setCaptions(false)),
    ...list.map((t) => row(t.label, on && t.id === now, () => setCaptions(true, t.id))),
    ...(!list.length && P?.caps ? [el("p", { className: "amb-note", textContent: on ? "Looking for captions…" : "Turn captions on to see this video's languages." })] : []),
  );
  if (!list.length && P?.caps && !on) box.lastChild.before(row("On", false, () => setCaptions(true)));
}

/* remember where long videos were left */
let lastSave = 0;
function savePos(force) {
  if (!P || P.embed || !cur?.key || cur.local) return;
  const d = P.d, t = P.t;
  if (d < 60) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  const all = store.get("pos", {});
  if (t > 10 && t < d - 10) all[cur.key] = Math.round(t); else delete all[cur.key];
  const keys = Object.keys(all);
  if (keys.length > 60) delete all[keys[0]];
  store.set("pos", all);
}
function resumeCheck() {
  if (!P || !cur?.key || cur.start || P.d < 60) return;
  const t = store.get("pos", {})[cur.key];
  if (!t || t > P.d - 10) return;
  P.seek(t, true);
  $("#resume-text").textContent = `Picked up at ${fmt(t)}`;
  $("#resume").hidden = false;
  setTimeout(() => ($("#resume").hidden = true), 7000);
}
$("#restart").addEventListener("click", () => { seekTo(0); $("#resume").hidden = true; });
addEventListener("pagehide", () => savePos(true));

/* media session (lock screen, headphones, keyboards with media keys) */
function mediaMeta() {
  if (!("mediaSession" in navigator) || !cur || typeof MediaMetadata === "undefined") return;
  try {
    const art = cur.thumb ? [{ src: new URL(cur.thumb, location.href).href, sizes: cur.shape === "tall" ? "360x640" : "640x360", type: "image/jpeg" }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title || "Video", artist: cur.artist || "", album: "Nishal K · Videos", artwork: art });
  } catch {}
}
function mediaState() {
  if (!("mediaSession" in navigator) || !P) return;
  try {
    navigator.mediaSession.playbackState = P.paused ? "paused" : "playing";
    if (P.d && isFinite(P.d)) navigator.mediaSession.setPositionState?.({ duration: P.d, position: clamp(P.t, 0, P.d), playbackRate: prefs.rate });
  } catch {}
}
if ("mediaSession" in navigator) {
  const h = {
    play: () => P?.play(), pause: () => P?.pause(),
    seekbackward: (e) => seekBy(-(e.seekOffset || 10)), seekforward: (e) => seekBy(e.seekOffset || 10),
    seekto: (e) => seekTo(e.seekTime), nexttrack: () => nextItem(),
  };
  for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
}

/* ---------- auto-hiding controls ---------- */
let hideT = 0;
const menusOpen = () => ["settings", "ambient", "chapters", "subs"].some((id) => !$("#" + id).hidden);
// keep captions above the control bar while it's showing (W3C media checklist VP-5)
function placeCues(up) {
  for (const t of textTracks()) for (const c of t.cues || []) { try { c.line = up ? -4 : "auto"; } catch {} }
}
new MutationObserver(() => placeCues(!stage.classList.contains("idle"))).observe(stage, { attributes: true, attributeFilter: ["class"] });
function poke() {
  stage.classList.remove("idle");
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    if (!P || P.paused || menusOpen() || dragging) return;
    if ($("#chrome").matches(":hover") || $("#chrome").contains(document.activeElement)) return poke();
    stage.classList.add("idle");
  }, 2600);
}
stage.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") poke(); });
stage.addEventListener("focusin", poke);
stage.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "mouse" || !P || P.paused || menusOpen()) return;
  clearTimeout(hideT);
  hideT = setTimeout(() => stage.classList.add("idle"), 800);
});

/* click, double click, double tap */
let lastTap = 0, lastSide = 0, tapT = 0;
let swallow = false;
shield.addEventListener("pointerup", (e) => {
  if (e.button > 0) return;
  if (swallow) { swallow = false; return; }
  if (menusOpen()) { closeMenus(); return; }
  if (e.pointerType === "mouse") {
    // a click toggles play; a double click (two clicks) toggles it back and goes full screen
    toggle();
    bezel(P?.paused ? "#i-pause" : "#i-play");
    poke();
    return;
  }
  const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  const side = x < 0.36 ? -1 : x > 0.64 ? 1 : 0, now = performance.now();
  if (side && now - lastTap < 320 && side === lastSide) {
    clearTimeout(tapT);
    seekBy(side * 10);
    const rip = $(side < 0 ? ".ripple.left" : ".ripple.right");
    rip.classList.remove("show"); void rip.offsetWidth; rip.classList.add("show");
    lastTap = now;
    return;
  }
  lastTap = now; lastSide = side;
  clearTimeout(tapT);
  tapT = setTimeout(() => {
    if (stage.classList.contains("idle") || P?.paused) poke();
    else { clearTimeout(hideT); stage.classList.add("idle"); }
  }, 280);
});
shield.addEventListener("dblclick", (e) => { if (!coarse.matches) { e.preventDefault(); toggleFS(); } });

/* ---------- control wiring ---------- */
playBtn.addEventListener("click", toggle);
bigPlay.addEventListener("click", toggle);
$("#next").addEventListener("click", nextItem);
$("#mute").addEventListener("click", () => {
  const off = prefs.muted || prefs.volume === 0;
  setVolume(off && prefs.volume === 0 ? 0.6 : prefs.volume, !off);
});
$("#volume").addEventListener("input", (e) => setVolume(e.target.value / 100, +e.target.value === 0));
$("#time").addEventListener("click", () => {
  prefs.remaining = !prefs.remaining;
  store.set("remaining", prefs.remaining);
  $("#time").setAttribute("aria-label", prefs.remaining ? "Show elapsed time" : "Show time remaining");
  lastText = "";
  paint();
});
$("#cc").addEventListener("click", toggleCaptions);
$("#loop-btn").addEventListener("click", () => { setLoop(!loop); bezel(loop ? "Loop on" : "Loop off"); });
$("#pip").addEventListener("click", togglePiP);
$("#theater").addEventListener("click", () => setTheater(!prefs.theater));
$("#fs").addEventListener("click", toggleFS);
for (const b of [$("#m-autoplay"), $("#autoplay")]) b.addEventListener("click", () => { prefs.autoplay = !prefs.autoplay; store.set("autoplay", prefs.autoplay); syncToggles(); });
$("#m-loop").addEventListener("click", () => setLoop(!loop));
$("#speeds").append(...RATES.map((r) => {
  const b = el("button", { type: "button", textContent: r === 1 ? "1×" : String(r) });
  b.setAttribute("role", "menuitemradio");
  b.setAttribute("aria-label", `${r}× speed`);
  b.dataset.r = r;
  b.addEventListener("click", () => setRate(r));
  return b;
}));

// scrubbing
const pv = $("#pv"), pvImg = $("#pv-img"), preview = $("#preview");
seek.addEventListener("input", () => {
  if (!P || !P.d) return;
  dragging = true;
  scrub.classList.add("dragging");
  P.seek((seek.value / 1000) * P.d, !P.yt);
  paint();
  showPreview(seek.value / 1000);
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  scrub.classList.remove("dragging");
  if (P?.d) P.seek((seek.value / 1000) * P.d, true);
  setState("ended", false);
  paint();
  poke();
};
seek.addEventListener("change", endDrag);
seek.addEventListener("pointerup", endDrag);
let pvBusy = false, pvWant = -1;
pv.addEventListener("seeked", () => { pvBusy = false; if (pvWant >= 0) { const w = pvWant; pvWant = -1; pvSeek(w); } });
function pvSeek(t) {
  if (pvBusy) { pvWant = t; return; }
  pvBusy = true;
  try { pv.fastSeek ? pv.fastSeek(t) : (pv.currentTime = t); } catch { pvBusy = false; }
  setTimeout(() => (pvBusy = false), 600);
}
function showPreview(frac) {
  if (!P?.d) return;
  const r = scrub.getBoundingClientRect();
  $("#pv-time").textContent = fmt(frac * P.d);
  $("#pv-chap").textContent = extras.chapterAt(frac * P.d)?.title || "";
  scrub.style.setProperty("--h", frac.toFixed(4));
  const tall = stage.dataset.shape === "tall";
  const fileFrame = P.native && cur?.kind === "file";
  const img = !fileFrame && amb.frameAt(frac * P.d, P.d);
  preview.classList.toggle("no-frame", !fileFrame && !img);
  preview.style.setProperty("--pva", tall ? "9 / 16" : "16 / 9");
  preview.style.setProperty("--pvw", tall ? "92px" : "176px");
  if (fileFrame) {
    pvImg.removeAttribute("src");
    if (pv.dataset.src !== video.currentSrc) { pv.dataset.src = video.currentSrc; pv.src = video.currentSrc; pv.preload = "auto"; pvBusy = false; }
    pvSeek(frac * P.d);
  } else if (img && pvImg.getAttribute("src") !== img) pvImg.src = img;
  const w = preview.offsetWidth || 176;
  preview.style.setProperty("--px", `${clamp(frac * r.width - w / 2, -4, r.width - w + 4).toFixed(1)}px`);
}
scrub.addEventListener("pointermove", (e) => {
  if (!P?.d || e.pointerType === "touch" && !dragging) return;
  const r = scrub.getBoundingClientRect();
  scrub.classList.add("hovering");
  showPreview(clamp((e.clientX - r.left) / r.width, 0, 1));
});
scrub.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") scrub.classList.add("hovering"); });
scrub.addEventListener("pointerleave", () => scrub.classList.remove("hovering"));
addEventListener("pointerup", () => scrub.classList.remove("hovering"));

// menus
function closeMenus() {
  for (const id of ["settings", "ambient", "chapters", "subs", "share-menu"]) $("#" + id).hidden = true;
  $("#settings-btn").setAttribute("aria-expanded", "false");
  $("#share").setAttribute("aria-expanded", "false");
}
$("#settings-btn").addEventListener("click", () => {
  const open = !menusOpen();
  closeMenus();
  if (open) {
    $("#settings").hidden = false;
    $("#settings-btn").setAttribute("aria-expanded", "true");
    ($("#speeds button[aria-checked=true]") || $("#speeds button")).focus({ preventScroll: true });
  }
  poke();
});
$("#m-ambient").addEventListener("click", () => { $("#settings").hidden = true; $("#ambient").hidden = false; $("#a-on").focus({ preventScroll: true }); });
$("#amb-back").addEventListener("click", () => { $("#ambient").hidden = true; $("#settings").hidden = false; $("#m-ambient").focus({ preventScroll: true }); });
$("#m-keys").addEventListener("click", () => { closeMenus(); openKeys(); });
function openKeys() { const d = $("#keys"); if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); }
$("#keys-close").addEventListener("click", () => $("#keys").close?.() ?? $("#keys").removeAttribute("open"));
$("#keys").addEventListener("click", (e) => { if (e.target === $("#keys")) $("#keys").close(); });
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".menu, #settings-btn, .share-menu, #share")) return;
  if (menusOpen() || !$("#share-menu").hidden) {
    closeMenus();
    if (e.target === shield) swallow = true;
  }
}, true);

/* share and download */
function shareUrl(withTime) {
  if (cur?.local) return null;
  const u = new URL(SITE);
  if (cur && cur !== CLIP && cur.share) u.searchParams.set("v", cur.share);
  if (withTime && P?.t > 1) u.searchParams.set("t", String(Math.floor(P.t)));
  return u.href;
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt("Copy this link", text); }
}
$("#share").setAttribute("aria-haspopup", "menu");
$("#share").setAttribute("aria-expanded", "false");
$("#share").addEventListener("click", () => {
  if (cur?.local) { closeMenus(); toast("Local files stay on your device"); return; }
  const m = $("#share-menu"), open = m.hidden;
  closeMenus();
  if (!open) return;
  $("#s-native").hidden = !navigator.share;
  $("#s-t").textContent = fmt(P?.t || 0);
  $("#s-copy-t").hidden = !P || P.embed || (P.t || 0) < 1;
  m.hidden = false;
  $("#share").setAttribute("aria-expanded", "true");
  m.querySelector("button:not([hidden])")?.focus();
});
$("#s-native").addEventListener("click", async () => { closeMenus(); if (cur?.local) return; try { await navigator.share({ title: cur?.title || "Video", url: shareUrl(false) }); } catch {} });
$("#s-copy").addEventListener("click", () => { closeMenus(); if (cur?.local) return; copy(shareUrl(false), "Link copied"); });
$("#s-copy-t").addEventListener("click", () => { closeMenus(); if (cur?.local) return; copy(shareUrl(true), `Link at ${fmt(P?.t || 0)} copied`); });
$("#download").addEventListener("click", async (e) => {
  const d = cur?.download;
  if (!d?.remote) return; // same origin: the download attribute does it
  e.preventDefault();
  toast("Getting the file…");
  try {
    const r = await fetch(d.href, { mode: "cors" });
    if (!r.ok) throw new Error(r.status);
    if ((+r.headers.get("content-length") || 0) > 500e6) { r.body?.cancel(); throw new Error("too big"); }
    const url = URL.createObjectURL(await r.blob());
    const a = el("a", { href: url, download: d.name || "video" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast("Downloaded");
  } catch {
    window.open(d.href, "_blank", "noopener");
    toast("The file opened in a new tab. Save it from there.");
  }
});

/* ---------- keyboard ---------- */
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const tg = e.target;
  if (tg.closest?.("input:not([type=range]), textarea, select, [contenteditable], dialog")) {
    if (e.key === "Escape" && tg.id === "link") tg.blur();
    return;
  }
  if (e.key === "Escape") {
    if (menusOpen() || !$("#share-menu").hidden) { const back = menusOpen() ? $("#settings-btn") : $("#share"); closeMenus(); back.focus(); e.preventDefault(); }
    else if (stage.classList.contains("pseudo-fs")) pseudoFS(false);
    return;
  }
  if (tg.closest?.("button, a, summary, [role=menu]") && (e.key === " " || e.key === "Enter")) return;
  const k = e.key;
  const inPlayer = stage.contains(tg) || tg === document.body || !!fsEl();
  const done = () => { e.preventDefault(); poke(); };
  if (k === "?") { openKeys(); return e.preventDefault(); }
  if (k === "/") { $("#link").focus(); return e.preventDefault(); }
  if (k === "N" && e.shiftKey) { nextItem(); return done(); }
  if (k === "f" || k === "F") { toggleFS(); return done(); }
  if (k === "t" || k === "T") { setTheater(!prefs.theater); return done(); }
  if (!P || P.embed) return;
  if (tg === seek && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(k)) return;
  if (tg.type === "range" && k.startsWith("Arrow")) return;
  switch (k) {
    case " ": case "k": case "K": toggle(); bezel(P.paused ? "#i-pause" : "#i-play"); return done();
    case "j": case "J": seekBy(-10); bezel("−10 s"); return done();
    case "l": case "L": seekBy(10); bezel("+10 s"); return done();
    case "ArrowLeft": seekBy(-5); bezel("−5 s"); return done();
    case "ArrowRight": seekBy(5); bezel("+5 s"); return done();
    case "ArrowUp": case "ArrowDown":
      if (!inPlayer) return;
      setVolume(Math.round((prefs.volume + (k === "ArrowUp" ? 0.05 : -0.05)) * 100) / 100, false);
      bezel(`${Math.round(prefs.volume * 100)}%`); return done();
    case "m": case "M": setVolume(prefs.volume || 0.6, !prefs.muted); bezel(prefs.muted ? "Muted" : `${Math.round(prefs.volume * 100)}%`); return done();
    case "i": case "I": togglePiP(); return done();
    case "c": case "C": toggleCaptions(); return done();
    case "r": case "R": setLoop(!loop); bezel(loop ? "Loop on" : "Loop off"); return done();
    case "[": extras.abSet("a"); return done();
    case "]": extras.abSet("b"); return done();
    case "\\": extras.abSet("clear"); return done();
    case "S": if (e.shiftKey) { extras.snapshot(); return done(); } break;
    case "<": stepRate(-1); return done();
    case ">": stepRate(1); return done();
    case "Home": seekTo(0); return done();
    case "End": seekTo(P.d - 0.1); return done();
    case ",": case ".":
      if (!P.paused || !P.native) return;
      seekBy(k === "," ? -1 / 30 : 1 / 30); return done();
  }
  if (/^[0-9]$/.test(k)) { seekTo((P.d * +k) / 10); bezel(`${k}0%`); return done(); }
});

/* ---------- play any link, any file ---------- */
const linkMsg = $("#link-msg");
function say(msg, bad) { linkMsg.textContent = msg; linkMsg.classList.toggle("bad", !!bad); }
$("#link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let x = parseLink($("#link").value);
  if (x.error) { say(x.error, true); $("#link").focus(); return; }
  const btn = $("#link-form button[type=submit]");
  if (x.kind === "file" && x.guessed && !x.via) { say("Checking the link…"); btn.disabled = true; }
  x = await probeLink(x);
  btn.disabled = false;
  if (x.error) { say(x.error, true); $("#link").focus(); return; }
  say(x.start ? `Starting at ${fmt(x.start)}` : "");
  $("#link").value = x.src;
  $("#link").blur();
  load(itemFromParsed(x), { play: x.kind === "file" || x.kind === "hls" || x.kind === "dash", focus: true });
});
$("#link").addEventListener("input", () => linkMsg.classList.contains("bad") && say(""));
function playFile(f) {
  if (!f) return;
  if (!/^(video|audio)\//.test(f.type) && !/\.(mkv|mov|m4v|ogv|webm|mp4|avi|mp3|m4a|wav)$/i.test(f.name)) { say("That file isn't a video.", true); return; }
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(f);
  say("");
  const mb = f.size / 1048576;
  load({ key: "", kind: "file", src: blobUrl, local: true, shape: "wide", eyebrow: "From your device", title: f.name, metaText: `${mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb.toFixed(1) + " MB"} · plays on your device, nothing is uploaded` }, { play: true, push: false, focus: true });
}
$("#file").addEventListener("change", (e) => { playFile(e.target.files[0]); e.target.value = ""; });
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; dragDepth++; stage.classList.add("dragging-file"); });
addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove("dragging-file"); } });
addEventListener("dragover", (e) => { if (hasFiles(e) || e.target.closest?.(".stage")) e.preventDefault(); });
addEventListener("drop", (e) => {
  if (!hasFiles(e)) {
    const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (text && e.target.closest?.(".stage")) { e.preventDefault(); $("#link").value = text.split("\n")[0]; $("#link-form").requestSubmit(); }
    return;
  }
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove("dragging-file");
  playFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (!text || !/^(https?:\/\/|www\.|youtu)/i.test(text)) return;
  $("#link").value = text;
  $("#link-form").requestSubmit();
});
// keep the link field above an on-screen keyboard
$("#link").addEventListener("focus", () => {
  if (!window.visualViewport) return;
  const fix = () => {
    const r = $("#link").getBoundingClientRect(), vv = visualViewport;
    if (r.bottom > vv.height - 12) scrollBy({ top: r.bottom - vv.height + 24, behavior: "smooth" });
  };
  visualViewport.addEventListener("resize", fix, { once: true });
  setTimeout(fix, 350);
});

/* ---------- ambient light ----------
   Video files, HLS, DASH and local files: the glow is drawn from the playing <video> itself on every
   new frame (up to 30 a second), so it can't fall behind or drift. No second decoder is involved.
   YouTube and Vimeo can't be read (cross-origin). Calm (the default) uses YouTube's preview frames or
   the thumbnail, picked by the current position and crossfaded slowly. Live copy plays a muted,
   low-quality duplicate behind the player; it is only shown while it is provably on the same frame
   (within a quarter of a second, both playing or both paused). While either side buffers, seeks, plays
   an ad or changes speed the copy is hidden and the calm glow shows instead, and if the copy can't
   catch up within a few seconds it is dropped for that video. */
const AMB_DEFAULTS = { v: 4, on: true, mode: "live", reach: 180, blur: 36, bright: 1, sat: 1.25, opacity: 0.85, tint: true };
// every slider's range; saved values are pulled back inside these so an old or edited setting can't blow the light up
const AMB_RANGE = { reach: [16, 480], blur: [8, 80], bright: [0.4, 1.6], sat: [0.5, 2.5], opacity: [0.1, 1] };
const LIVE_MAX = 0.25, LIVE_SHOW = 0.15;
const amb = (() => {
  const saved = store.get("ambient", null);
  let s = tidy(saved);
  // the first version defaulted to a live copy that drifted and a much stronger, oval glow, so its values are dropped;
  // version 2 had a Size slider that did nothing, so only its size is reset
  function tidy(o) {
    if (!o || typeof o !== "object") return { ...AMB_DEFAULTS };
    const keep = { on: o.on !== false, tint: o.tint !== false };
    if (o.v !== 2 && o.v !== 3 && o.v !== 4) return { ...AMB_DEFAULTS, ...keep };
    // live copy became the default in version 4, so earlier saves move to it once
    const t = { ...AMB_DEFAULTS, ...keep, mode: o.v === 4 && o.mode === "light" ? "light" : "live" };
    for (const [k, [lo, hi]] of Object.entries(AMB_RANGE)) {
      if (k === "reach" && o.v === 2) continue;
      const v = Number(o[k]);
      if (Number.isFinite(v)) t[k] = clamp(v, lo, hi);
    }
    return t;
  }
  // several copies of the same small frame, each scaled further out and blurred more (see .glow in video.css);
  // they're 64x36 each, so drawing all of them costs next to nothing
  const layers = [glow, ...[1, 2, 3].map(() => glow.parentNode.insertBefore(el("canvas", { width: 64, height: 36 }), glow.nextSibling))];
  const ctxs = layers.map((c) => c.getContext("2d", { alpha: false })), ctx = ctxs[0];
  const tgt = el("canvas", { width: 64, height: 36 });
  const tctx = tgt.getContext("2d", { willReadFrequently: true });
  let source = null, colors = null, timer = 0, blendRaf = 0, blendLeft = 0, blendAlpha = 1, readable = true;
  let stillKey = "", lastColors = 0, vfc = 0, vraf = 0, lastVideoDraw = 0, hardNext = true;
  let mirror = null, mirrorTimer = 0, drift = 0, seeks = 0, skipKey = "", note = "";
  const neutral = ["#6b6f78", "#3a3d44"];

  function applyVars() {
    const st = root.style;
    st.setProperty("--amb-blur", s.blur + "px");
    st.setProperty("--amb-reach", s.reach + "px");
    st.setProperty("--amb-bright", s.bright);
    st.setProperty("--amb-sat", s.sat);
    st.setProperty("--amb-opacity", s.on ? s.opacity : 0);
    document.body.classList.toggle("no-ambient", !s.on);
    $(".backdrop").style.setProperty("--tint", s.on && s.tint ? 1 : 0);
    $("#m-ambient-state").textContent = (s.on ? (s.mode === "live" ? "Live copy" : "Calm") : "Off") + " ›";
    $("#a-on").setAttribute("aria-checked", String(s.on));
    $("#a-tint").setAttribute("aria-checked", String(s.tint));
    $$("#ambient .amb-modes button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === s.mode)));
    for (const inp of $$("#amb-sliders input")) {
      const k = inp.dataset.k, v = s[k];
      inp.value = v;
      $(`#amb-sliders output[data-for="${k}"]`).textContent = k === "blur" || k === "reach" ? `${v}px` : `${Math.round(v * 100)}%`;
    }
    $("#amb-note").textContent = (s.mode === "live"
      ? "Live copy plays a muted, low-quality duplicate of YouTube and Vimeo videos behind the player. It only shows while it's on the same frame, and uses more data."
      : "Calm uses preview frames and thumbnails for YouTube and Vimeo, picked by position. Video files always follow the real picture.") + " " + sourceText();
  }
  // say plainly what the light is following for the current video
  function sourceText() {
    if (!s.on) return "";
    if (note) return note;
    if (mirror) return mirror.visible ? "Now: a muted copy, in step with the picture." : "Now: lining up the copy; the calm glow shows until it's in step.";
    const t = source?.type;
    if (t === "video") return readable ? "Now: the real picture, frame by frame." : "Now: this server doesn't let the page read the picture, so the colours are fixed.";
    if (t === "sprite" || t === "frames") return source.n > 1 || source.frames?.length > 1 ? "Now: preview frames, picked by position." : "Now: the thumbnail, one colour for the whole video.";
    return "Now: a neutral glow, because this site shares no picture.";
  }
  function save() { store.set("ambient", s); applyVars(); }
  function setColors(c) { root.style.setProperty("--amb1", c[0]); root.style.setProperty("--amb2", c[1] || c[0]); }
  function readColors() {
    if (!readable) return;
    let px;
    try { px = tctx.getImageData(0, 0, 64, 36).data; } catch { readable = false; setColors(colors || neutral); applyVars(); return; }
    const avg = (x0, x1) => {
      let r = 0, g = 0, b = 0, w = 0;
      for (let y = 0; y < 36; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * 64 + x) * 4, R = px[i], G = px[i + 1], B = px[i + 2];
        const wt = 0.2 + (Math.max(R, G, B) - Math.min(R, G, B)) / 255 + (Math.max(R, G, B) > 40 ? 0.3 : 0);
        r += R * wt; g += G * wt; b += B * wt; w += wt;
      }
      return `rgb(${(r / w) | 0} ${(g / w) | 0} ${(b / w) | 0})`;
    };
    setColors([avg(0, 32), avg(32, 64)]);
  }
  // the light is the current picture, drawn whole; CSS scales it out past the player, blurs it and fades its edges
  function put(alpha) {
    for (const c of ctxs) { c.globalAlpha = alpha; c.drawImage(tgt, 0, 0); c.globalAlpha = 1; }
  }
  function draw(img, sx = 0, sy = 0, sw = img.naturalWidth || img.videoWidth, sh = img.naturalHeight || img.videoHeight) {
    if (!sw || !sh) return false;
    try { tctx.drawImage(img, sx, sy, sw, sh, 0, 0, 64, 36); return true; } catch { return false; }
  }
  const okImg = (img) => img.complete && img.naturalWidth > 0;
  function pickFrame(t, d) {
    if (source?.type !== "frames") return null;
    const f = d ? t / d : 0;
    let pick = null;
    for (const fr of source.frames) if (okImg(fr.img) && fr.at <= f + 0.001) pick = fr;
    return pick || source.frames.find((fr) => okImg(fr.img)) || null;
  }
  function frameAt(t, d) {
    if (source?.type === "frames") return pickFrame(t, d)?.img.src || null;
    if (source?.type === "sprite") return cur?.thumb || null;
    return null;
  }
  const active = () => s.on && !document.hidden && !!cur;

  /* the real picture: one draw per presented frame, capped at ~30 a second */
  function drawVideo(hard) {
    if (!active() || source?.type !== "video" || video.readyState < 2 || !draw(video)) return;
    lastVideoDraw = performance.now();
    put(hard || reduceMotion.matches ? 1 : 0.6); // a two-frame ease; never a visible trail
    if (hard || lastVideoDraw - lastColors > 500) { lastColors = lastVideoDraw; readColors(); }
  }
  function stopFollow() {
    if (vfc) video.cancelVideoFrameCallback?.(vfc);
    cancelAnimationFrame(vraf);
    vfc = vraf = 0;
  }
  function follow() {
    stopFollow();
    if (!active() || source?.type !== "video") return;
    if (video.requestVideoFrameCallback) {
      const step = () => {
        vfc = video.requestVideoFrameCallback(step);
        if (performance.now() - lastVideoDraw >= 30 || hardNext) { drawVideo(hardNext); hardNext = false; }
      };
      vfc = video.requestVideoFrameCallback(step);
    } else {
      const step = () => {
        vraf = requestAnimationFrame(step);
        if (!video.paused && performance.now() - lastVideoDraw >= 30) drawVideo(false);
      };
      vraf = requestAnimationFrame(step);
    }
    drawVideo(true);
  }
  // a jump in the picture (seek, new source, loop) replaces the glow at once instead of easing
  for (const ev of ["seeked", "loadeddata", "emptied"]) video.addEventListener(ev, () => { hardNext = true; if (P?.native) drawVideo(true); });
  video.addEventListener("seeking", () => { hardNext = true; });

  /* stills for YouTube, Vimeo and the rest: chosen by position, crossfaded over about a second */
  function sampleStill(force) {
    if (!active() || source?.type === "video" || mirror?.visible) return;
    const t = P?.t || 0, d = P?.d || 0;
    let ok = false, key = "";
    if (source?.type === "sprite") {
      const sp = source;
      if (okImg(sp.img)) {
        const i = clamp(Math.floor(sp.step ? t / sp.step : (d ? t / d : 0) * sp.n), 0, sp.n - 1);
        key = "s" + i;
        ok = key === stillKey && !force ? null : draw(sp.img, (i % sp.cols) * sp.w, Math.floor(i / sp.cols) * sp.h, sp.w, sp.h);
      }
    } else if (source?.type === "frames") {
      const fr = pickFrame(t, d);
      if (fr) { key = fr.img.src; ok = key === stillKey && !force ? null : draw(fr.img); }
    }
    if (ok === null) return; // same still as before
    if (!ok) {
      key = "c";
      if (key === stillKey && !force) return;
      const c = colors || neutral, g = tctx.createLinearGradient(0, 0, 64, 36);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1] || c[0]);
      tctx.fillStyle = g; tctx.fillRect(0, 0, 64, 36);
    }
    const first = !stillKey;
    stillKey = key;
    readColors();
    blendAlpha = first || reduceMotion.matches ? 1 : 0.05;
    blendLeft = first || reduceMotion.matches ? 1 : 80;
    if (!blendRaf) blendRaf = requestAnimationFrame(blend);
  }
  function blend() {
    blendRaf = 0;
    put(blendAlpha);
    if (--blendLeft > 0) blendRaf = requestAnimationFrame(blend);
  }
  function schedule() {
    clearInterval(timer);
    timer = 0;
    stopFollow();
    if (!active()) return;
    if (source?.type === "video") { follow(); return; }
    sampleStill(false);
    timer = setInterval(() => sampleStill(false), 500);
  }
  function kick() { schedule(); mirrorTick(true); }

  function img(src, cors) {
    const i = new Image();
    if (cors) i.crossOrigin = "anonymous";
    i.decoding = "async";
    i.addEventListener("load", () => sampleStill(true), { once: true });
    i.src = src;
    return i;
  }
  function stills(it) {
    if (it.kind === "youtube" && it.id) {
      if (it.amb?.sprite) return { type: "sprite", ...it.amb, img: img(it.amb.sprite, false) };
      const local = it.thumb && !it.remoteThumb;
      return { type: "frames", frames: [
        { img: img(local ? it.thumb : `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`, !local), at: 0 },
        ...[1, 2, 3].map((k) => ({ img: img(`https://i.ytimg.com/vi/${it.id}/mq${k}.jpg`, true), at: k * 0.25 - 0.125 })),
      ] };
    }
    if (it.thumb) return { type: "frames", frames: [{ img: img(it.thumb, !!it.remoteThumb), at: 0 }] };
    return null;
  }
  function setSource(it) {
    stopMirror();
    note = "";
    readable = true;
    colors = it.colors || null;
    stillKey = "";
    hardNext = true;
    setColors(colors || neutral);
    source = it.kind === "file" || it.kind === "hls" || it.kind === "dash" ? { type: "video" } : stills(it);
    for (const c of ctxs) { c.fillStyle = "#000"; c.fillRect(0, 0, 64, 36); }
    startMirror(it);
    kick();
    applyVars();
  }
  // a thumbnail that turns up later (Vimeo's oEmbed) only swaps the stills; the copy keeps running
  function updateStills(it) {
    if (it !== cur || source?.type === "video") return;
    source = stills(it);
    stillKey = "";
    sampleStill(true);
    applyVars();
  }

  /* ----- Live copy (YouTube and Vimeo only) ----- */
  function wantMirror(it) {
    return servedFromWeb && s.on && s.mode === "live" && (it.kind === "youtube" || it.kind === "vimeo") && it.id && !prefs.theater && skipKey !== it.key;
  }
  function mirrorFrame(src) {
    const f = frame(src, "Ambient light (decorative copy)");
    f.className = "mirror";
    f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true");
    glowBox.append(f);
    return f;
  }
  function startMirror(it) {
    if (!wantMirror(it)) return;
    const base = { item: it, ready: false, visible: false, okSince: 0, badSince: 0, seekAt: 0, settled: true, lead: 0.2, last: null, mainLast: null };
    if (it.kind === "youtube") {
      const m = (mirror = { ...base, kind: "yt", frame: mirrorFrame(ytSrc(it, true)), state: -1 });
      loadYT().then(() => {
        if (mirror !== m) return;
        m.player = new window.YT.Player(m.frame, {
          events: {
            onReady() { if (mirror !== m) return; m.ready = true; m.player.mute(); try { m.player.setPlaybackQuality("tiny"); } catch {} mirrorTick(true); },
            onStateChange(e) { m.state = e.data; if (e.data !== 3) m.settled = true; mirrorTick(true); },
            onError() { if (mirror === m) giveUp("Now: the copy can't play here, so preview frames are used."); },
          },
        });
      }).catch(() => { if (mirror === m) giveUp(""); });
    } else {
      const m = (mirror = { ...base, kind: "vimeo", frame: mirrorFrame(vimeoSrc(it, true)), t: 0, tAt: 0, paused: true, buffering: false, rate: 1 });
      m.off = vimeoListen(m.frame, (msg) => {
        const d = msg.data || {};
        if (msg.event === "ready") { m.ready = true; vimeoPost(m.frame, "setVolume", 0); mirrorTick(true); }
        else if (msg.event === "timeupdate") { m.t = d.seconds || 0; m.tAt = performance.now(); }
        else if (msg.event === "seeked") { m.t = d.seconds ?? m.t; m.tAt = performance.now(); m.settled = true; }
        else if (msg.event === "play" || msg.event === "playing") { m.paused = false; m.tAt = performance.now(); }
        else if (msg.event === "pause" || msg.event === "ended") { m.paused = true; }
        else if (msg.event === "bufferstart") m.buffering = true;
        else if (msg.event === "bufferend") { m.buffering = false; m.tAt = performance.now(); }
        else if (msg.event === "playbackratechange") m.rate = d.playbackRate || 1;
        else return;
        if (msg.event !== "timeupdate") mirrorTick(true);
      });
    }
    clearInterval(mirrorTimer);
    mirrorTimer = setInterval(() => mirrorTick(false), 200);
  }
  function stopMirror() {
    clearInterval(mirrorTimer);
    mirrorTimer = 0;
    if (!mirror) return;
    try { mirror.player?.destroy(); } catch {}
    mirror.off?.();
    mirror.frame?.remove();
    mirror = null;
    glowBox.classList.remove("mirroring");
    $$(".glow .mirror").forEach((x) => x.remove());
  }
  function giveUp(why) {
    if (!mirror) return;
    skipKey = mirror.item.key;
    note = why;
    stopMirror();
    stillKey = "";
    schedule();
    applyVars();
  }
  function show(m, on) {
    if (m.visible === on) return;
    m.visible = on;
    glowBox.classList.toggle("mirroring", on);
    if (!on) { stillKey = ""; sampleStill(true); }
    applyVars();
  }
  // where each side is: "play", "pause", "buffer" or "end"
  function mainStatus() {
    if (!P || P.embed) return "pause";
    if (P.yt) { const st = P.state; return st === 1 ? "play" : st === 3 ? "buffer" : st === 0 ? "end" : "pause"; }
    if (P.vimeo) return P.ended ? "end" : P.paused ? "pause" : P.buffering ? "buffer" : "play";
    return P.paused ? "pause" : "play";
  }
  function mirrorStatus(m) {
    if (m.kind === "yt") return m.state === 1 ? "play" : m.state === 3 || (m.state === -1 && !m.settled) ? "buffer" : m.state === 0 ? "end" : "pause";
    return m.buffering ? "buffer" : m.paused ? "pause" : "play";
  }
  function mirrorTime(m) {
    if (m.kind === "yt") return m.player.getCurrentTime?.() || 0;
    return m.t + (!m.paused && !m.buffering && m.tAt ? ((performance.now() - m.tAt) / 1000) * m.rate : 0);
  }
  // true when a clock that should be running hasn't moved (buffering the API doesn't report, or an ad)
  function stalled(rec, t, now) {
    const prev = rec.last;
    if (prev && now - prev.now < 150) return rec.stalled || false;
    rec.last = { t, now };
    if (!prev) return false;
    const want = ((now - prev.now) / 1000) * prefs.rate, got = t - prev.t;
    rec.stalled = want > 0.12 && (got < want * 0.4 || got > want * 3 + 0.5);
    return rec.stalled;
  }
  function seekMirror(m, t) {
    m.seekAt = performance.now();
    m.settled = false;
    m.okSince = 0;
    m.measured = false;
    m.last = null;
    seeks++;
    if (m.kind === "yt") m.player.seekTo(Math.max(0, t), true);
    else { m.t = Math.max(0, t); m.tAt = performance.now(); vimeoPost(m.frame, "setCurrentTime", m.t); }
  }
  function mirrorTick(force) {
    const m = mirror;
    if (!m?.ready || !P || !cur) return;
    const now = performance.now();
    const hidden = document.hidden || !glowBox.offsetWidth || !!fsEl();
    const ms = mainStatus(), mm = mirrorStatus(m);
    const want = ms === "play" && !hidden ? "play" : "pause";
    const t = P.t, mt = mirrorTime(m);
    drift = mt - t;
    const mainStuck = ms === "play" ? stalled((m.mainLast ||= {}), t, now) : ((m.mainLast = null), false);
    const copyStuck = mm === "play" ? stalled((m.copyLast ||= {}), mt, now) : ((m.copyLast = null), false);

    // speed first, so the clocks are comparable
    if (m.kind === "yt") { if (m.player.getPlaybackRate?.() !== prefs.rate) { m.player.setPlaybackRate(prefs.rate); m.okSince = 0; } }
    else if (m.rate !== prefs.rate) { vimeoPost(m.frame, "setPlaybackRate", prefs.rate); m.rate = prefs.rate; m.okSince = 0; }

    // play and pause follow the main player straight away
    if (want === "play" && (mm === "pause" || mm === "end")) m.kind === "yt" ? m.player.playVideo() : vimeoPost(m.frame, "play");
    if (want === "pause" && (mm === "play" || mm === "buffer")) m.kind === "yt" ? m.player.pauseVideo() : vimeoPost(m.frame, "pause");

    // hard seek when it's off by more than a quarter second; leave it alone while a seek is landing
    if (!m.settled && now - m.seekAt > (mm === "play" ? 400 : 800) && (mm === "play" || mm === "pause")) m.settled = true;
    const landing = !m.settled && now - m.seekAt < 3000;
    if (!landing && !mainStuck && ms !== "buffer" && ms !== "end" && Math.abs(drift) > (want === "play" ? LIVE_MAX : 0.05) && now - m.seekAt > 700) {
      seekMirror(m, t + (want === "play" ? m.lead * prefs.rate : 0));
    }
    // learn how long a seek takes to land, so the next one aims a little ahead
    if (m.settled && m.seekAt && !m.measured && mm === "play" && ms === "play" && now - m.seekAt > 300 && now - m.seekAt < 4000) {
      m.measured = true;
      m.lead = clamp(m.lead - drift / prefs.rate, 0, 1.2);
    }

    // only show the copy while it's provably on the same picture
    const same = (ms === "play" && mm === "play") || (ms === "pause" && mm === "pause");
    const good = !hidden && same && !landing && !mainStuck && !copyStuck && now - m.seekAt > 400 && Math.abs(drift) <= (m.visible ? LIVE_MAX : LIVE_SHOW);
    if (good) {
      m.badSince = 0;
      m.okSince ||= now;
      if (now - m.okSince >= (ms === "play" ? 600 : 300)) show(m, true);
    } else {
      m.okSince = 0;
      show(m, false);
      // the main picture is moving but the copy can't keep up: give up on it for this video
      if (ms === "play" && !hidden && !mainStuck) {
        m.badSince ||= now;
        if (now - m.badSince > 6000) giveUp("Now: the copy couldn't keep up on this connection, so preview frames are used.");
      } else m.badSince = 0;
    }
    if (force) applyVars();
  }
  document.addEventListener("visibilitychange", () => { hardNext = true; schedule(); mirrorTick(true); });
  reduceMotion.addEventListener?.("change", schedule);

  $("#a-on").addEventListener("click", () => { s.on = !s.on; save(); if (cur) setSource(cur); });
  $("#a-tint").addEventListener("click", () => { s.tint = !s.tint; save(); });
  $$("#ambient .amb-modes button").forEach((b) => b.addEventListener("click", () => { s.mode = b.dataset.mode; skipKey = ""; save(); if (cur) setSource(cur); }));
  $$("#amb-sliders input").forEach((inp) => inp.addEventListener("input", () => { const k = inp.dataset.k, [lo, hi] = AMB_RANGE[k]; s[k] = clamp(+inp.value || AMB_DEFAULTS[k], lo, hi); save(); }));
  $("#a-reset").addEventListener("click", () => { s = { ...AMB_DEFAULTS }; skipKey = ""; save(); if (cur) setSource(cur); });
  applyVars();
  return {
    setSource, updateStills, kick, stopMirror, frameAt,
    sync() { mirrorTick(true); },
    // a seek on the main player hides the copy at once and lines it up again
    seeked(t) { if (mirror?.ready) { show(mirror, false); seekMirror(mirror, t); } stillKey = ""; },
    refresh() { if (cur && (cur.kind === "youtube" || cur.kind === "vimeo")) setSource(cur); },
    get stats() { return { mode: s.mode, on: s.on, mirroring: !!mirror?.ready, visible: !!mirror?.visible, drift, seeks, lead: mirror?.lead, source: source?.type || (colors ? "colors" : "neutral"), lastDraw: lastVideoDraw }; },
  };
})();

/* ---------- extras: chapters, subtitles, repeat a part, sleep timer, frame capture, fill, boost,
   mini player, continue watching, queue reordering, offline shell. Everything advanced lives in
   the settings menu so the bar stays as plain as YouTube's. ---------- */
const extras = (() => {
  let chapters = [], userTrack = null, subsUrl = null;
  let abA = null, abB = null;
  let sleepT = 0, sleepEnd = false, sleepIdx = 0, sleepAt = 0;
  let actx = null, gain = null, comp = null, boost = false, graphOn = false;
  const safeSrc = () => { const s = video.currentSrc || ""; return s.startsWith("blob:") || s.startsWith(location.origin); };
  const back = (panel, rowId) => { $("#" + panel).hidden = true; $("#settings").hidden = false; $("#" + rowId).focus({ preventScroll: true }); };
  const openPanel = (id, focusSel) => { closeMenus(); $("#" + id).hidden = false; $("#settings-btn").setAttribute("aria-expanded", "true"); ($(focusSel) || $("#" + id + " button")).focus({ preventScroll: true }); poke(); };
  $$(".menu [data-back]").forEach((b) => b.addEventListener("click", () => back(b.closest(".menu").id, b.dataset.back)));

  /* chapters: YouTube's own rule (first at 0:00, at least three) from the build, or a WebVTT chapters file */
  function setChapters(list) {
    chapters = (list || []).filter((c) => isFinite(c.t)).sort((a, b) => a.t - b.t);
    $("#m-chapters").hidden = $("#chap").hidden = !chapters.length;
    $("#chap-list").replaceChildren(...chapters.map((c, i) => {
      const b = el("button", { type: "button", className: "menu-row" }, el("span", { textContent: c.title }), el("span", { className: "chev", textContent: fmt(c.t) }));
      b.addEventListener("click", () => { seekTo(c.t); P?.paused && P.play(); closeMenus(); });
      b.dataset.i = i;
      return el("li", {}, b);
    }));
    drawMarks();
  }
  function drawMarks() {
    const d = P?.d;
    $("#chap-marks").replaceChildren(...(d ? chapters.slice(1).map((c) => el("i", { style: `left:${((c.t / d) * 100).toFixed(3)}%` })) : []));
  }
  function chapterAt(t) { let c = null; for (const x of chapters) if (x.t <= t + 0.01) c = x; return c; }
  $("#m-chapters").addEventListener("click", () => openPanel("chapters", "#chap-list .now button"));
  $("#chap").addEventListener("click", () => { if ($("#chapters").hidden) openPanel("chapters", "#chap-list .now button"); else closeMenus(); });

  /* subtitles from a file or a link; SRT is converted to WebVTT in the browser */
  function toVtt(text) {
    text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (/^WEBVTT/.test(text)) return text;
    return "WEBVTT\n\n" + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").replace(/^\d+\n(?=\d{2}:\d{2})/gm, "");
  }
  function addSubs(text, name) {
    if (!P?.native) { toast("Subtitles work with video files and streams"); return; }
    if (text.length > 5e6) { toast("That subtitle file is too big"); return; }
    const vtt = toVtt(text);
    if (!/-->/.test(vtt)) { toast("That doesn't look like a subtitle file"); return; }
    clearSubs();
    const asChapters = /chapter/i.test(name);
    subsUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    userTrack = el("track", { kind: asChapters ? "chapters" : "subtitles", label: name.replace(/\.(vtt|srt)$/i, "") || "Subtitles", srclang: "und", src: subsUrl });
    video.append(userTrack);
    const tt = userTrack.track;
    if (asChapters) {
      tt.mode = "hidden";
      userTrack.addEventListener("load", () => setChapters([...tt.cues].map((c) => ({ t: c.startTime, title: c.text.replace(/<[^>]*>/g, "") }))), { once: true });
      toast("Chapters added");
    } else {
      store.set("captions", true);
      store.set("capLang", "und");
      captionsCheck();
      $("#m-subs-state").textContent = "On ›";
      toast("Subtitles added. Press C to hide them.");
    }
    closeMenus();
  }
  function clearSubs() {
    userTrack?.remove(); userTrack = null;
    if (subsUrl) URL.revokeObjectURL(subsUrl), (subsUrl = null);
    $("#m-subs-state").textContent = "Off ›";
    captionsCheck();
  }
  $("#m-subs").addEventListener("click", () => {
    $("#subs-note").textContent = P?.native ? "Or add a .vtt or .srt file. It stays on your device. Name it with “chapters” to load chapters instead." : "YouTube and Vimeo captions come from the video. Your own subtitle files work with video files and streams.";
    renderCapList();
    openPanel("subs", "#subs-file");
  });
  $("#subs-file").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) addSubs(await f.text(), f.name); });
  $("#subs-url").addEventListener("submit", async (e) => {
    e.preventDefault();
    let u;
    try { u = new URL($("#subs-link").value.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { toast("That isn't a web link"); return; }
    try {
      const r = await fetch(u, { mode: "cors", credentials: "omit" });
      if (!r.ok) throw 0;
      addSubs(await r.text(), fileName(u));
    } catch { toast("That server doesn't let other sites read its subtitles. Download the file and add it instead."); }
  });
  const cue = { size: store.get("cueSize", "m"), bg: store.get("cueBg", true) };
  function applyCue() {
    stage.dataset.cue = cue.size;
    stage.classList.toggle("cue-plain", !cue.bg);
    $$("#cue-size button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.size === cue.size)));
    $("#cue-bg").setAttribute("aria-checked", String(cue.bg));
  }
  $$("#cue-size button").forEach((b) => b.addEventListener("click", () => { cue.size = b.dataset.size; store.set("cueSize", cue.size); applyCue(); }));
  $("#cue-bg").addEventListener("click", () => { cue.bg = !cue.bg; store.set("cueBg", cue.bg); applyCue(); });
  applyCue();

  /* repeat a part (A-B) */
  function abSet(what) {
    if (!P || P.embed) return;
    if (what === "clear") { abA = abB = null; bezel("Repeat off"); }
    else if (what === "a") { abA = P.t; if (abB != null && abB <= abA + 0.5) abB = null; bezel(`From ${fmt(abA)}`); }
    else { if (abA == null) abA = 0; if (P.t <= abA + 0.5) { toast("Pick a point after the start"); return; } abB = P.t; bezel(`${fmt(abA)} to ${fmt(abB)}`); }
    abUI();
  }
  function abUI() {
    const r = $("#ab-range"), d = P?.d;
    r.hidden = abA == null || !d;
    if (!r.hidden) { r.style.left = `${(abA / d) * 100}%`; r.style.width = `${(((abB ?? d) - abA) / d) * 100}%`; }
    $("#m-ab-state").textContent = abA == null ? "Set start" : abB == null ? `${fmt(abA)} · set end` : `${fmt(abA)}–${fmt(abB)} · stop`;
  }
  $("#m-ab").addEventListener("click", () => abSet(abA == null ? "a" : abB == null ? "b" : "clear"));

  /* sleep timer */
  const SLEEP = [0, 15, 30, 60, "end"];
  function setSleep(i) {
    clearTimeout(sleepT); sleepEnd = false; sleepIdx = i; sleepAt = 0;
    const v = SLEEP[i];
    if (v === "end") sleepEnd = true;
    else if (v) { sleepAt = Date.now() + v * 60000; sleepT = setTimeout(() => { P?.pause(); setSleep(0); toast("Paused by the sleep timer"); }, v * 60000); }
    sleepLabel();
  }
  function sleepLabel() {
    const v = SLEEP[sleepIdx];
    $("#m-sleep-state").textContent = !v ? "Off" : v === "end" ? "End of video" : `${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000))} min`;
  }
  $("#m-sleep").addEventListener("click", () => setSleep((sleepIdx + 1) % SLEEP.length));
  function sleepAtEnd() { if (!sleepEnd) return false; setSleep(0); toast("Stopped at the end, as asked"); return true; }

  /* save the current frame (video files whose server allows it) */
  function snapshot() {
    if (!P?.native || !video.videoWidth) { toast("Frames can be saved from video files"); return; }
    const c = el("canvas", { width: video.videoWidth, height: video.videoHeight });
    try {
      c.getContext("2d").drawImage(video, 0, 0);
      c.toBlob((b) => {
        if (!b) { toast("This frame couldn't be saved"); return; }
        const url = URL.createObjectURL(b);
        const a = el("a", { href: url, download: `${(cur?.title || "frame").replace(/\.\w{2,4}$/, "").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "frame"} ${fmt(P.t).replace(":", "-")}.png` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20000);
        toast("Frame saved");
      }, "image/png");
    } catch { toast("This video's server doesn't allow saving frames"); }
  }
  $("#m-shot").addEventListener("click", () => { closeMenus(); snapshot(); });

  /* fill the frame (crop instead of bars) */
  function setFill(on) { stage.classList.toggle("fill", on); $("#m-fill").setAttribute("aria-checked", String(on)); store.set("fill", on); }
  $("#m-fill").addEventListener("click", () => setFill(!stage.classList.contains("fill")));
  setFill(store.get("fill", false));

  /* volume boost: Web Audio gain with a compressor so quiet videos get louder without clipping.
     Only for same-origin, local and streamed sources; a cross-origin file without CORS would go silent. */
  function setBoost(on) {
    if (on && !safeSrc()) { toast("Boost works with local files, streams and this site's clip"); return; }
    if (on && !actx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC();
        const srcNode = actx.createMediaElementSource(video);
        comp = actx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
        gain = actx.createGain();
        srcNode.connect(comp).connect(gain).connect(actx.destination);
        graphOn = true;
      } catch { toast("This browser can't boost the volume"); return; }
    }
    boost = on;
    if (gain) { gain.gain.value = on ? 2.2 : 1; comp.threshold.value = on ? -24 : 0; comp.ratio.value = on ? 4 : 1; }
    actx?.resume?.();
    $("#m-boost").setAttribute("aria-checked", String(on));
  }
  $("#m-boost").addEventListener("click", () => setBoost(!boost));
  // once the audio graph exists, a cross-origin file without CORS would play silently; say so
  video.addEventListener("loadedmetadata", () => {
    if (graphOn && !safeSrc() && !video.crossOrigin) onError("Volume boost was used earlier, so this file can't be heard here. Open the link again to play it with sound.", cur?.local ? null : shareUrl(false));
  });

  /* mini player: the same element pins to a corner while you scroll, so YouTube never reloads */
  const wrap = $(".stage-wrap");
  let mini = store.get("mini", true), wrapVisible = true;
  $("#m-mini").setAttribute("aria-checked", String(mini));
  $("#m-mini").addEventListener("click", () => { mini = !mini; store.set("mini", mini); $("#m-mini").setAttribute("aria-checked", String(mini)); miniCheck(); });
  function miniCheck() {
    const want = mini && !wrapVisible && P && !P.paused && !fsEl() && !stage.classList.contains("pseudo-fs") && !P.embed;
    if (want === wrap.classList.contains("mini")) return;
    if (want) wrap.style.height = `${wrap.offsetHeight}px`;
    else wrap.style.height = "";
    wrap.classList.toggle("mini", !!want);
  }
  new IntersectionObserver(([e]) => { wrapVisible = e.intersectionRatio > 0.35; miniCheck(); }, { threshold: [0, 0.35, 1] }).observe(wrap);
  $("#mini-close").addEventListener("click", (e) => { e.stopPropagation(); P?.pause(); wrap.classList.remove("mini"); wrap.style.height = ""; });

  /* continue watching (videos over a minute, on this device only) */
  function remember() {
    if (!P || P.embed || !cur?.key || cur.local || !cur.share && cur !== CLIP) return;
    const d = P.d, t = P.t;
    if (!(d >= 60)) return;
    let h = store.get("hist", []).filter((x) => x.key !== cur.key);
    if (t > 10 && t < d * 0.95) h.unshift({ key: cur.key, share: cur.share || "", title: cur.title, thumb: cur.remoteThumb || !cur.thumb ? (cur.thumb || "") : new URL(cur.thumb, location.href).href, shape: cur.shape, t: Math.round(t), d: Math.round(d), at: Date.now() });
    store.set("hist", h.slice(0, 20));
  }
  function renderCW() {
    const h = store.get("hist", []).filter((x) => x.share && x.key !== cur?.key);
    $("#cw-wrap").hidden = !h.length;
    $("#cw").replaceChildren(...h.map((x) => {
      const fromLib = library.find((it) => it.key === x.key);
      const p = fromLib ? null : parseLink(x.share);
      const it = fromLib || (p && !p.error ? itemFromParsed(p) : null);
      if (!it) return "";
      if (!it.thumb && x.thumb && /^https:/.test(x.thumb)) it.thumb = x.thumb;
      const li = card(it);
      li.querySelector("p").textContent = `${fmt(x.t)} of ${fmt(x.d)}`;
      const bar = el("span", { className: "progress" }); bar.style.setProperty("--p", (x.t / x.d).toFixed(3));
      li.querySelector(".th").append(bar);
      return li;
    }));
  }
  $("#cw-clear").addEventListener("click", () => { store.set("hist", []); renderCW(); toast("Cleared"); });

  /* reorder Up next with the grip: drag with mouse or touch, or arrow keys on the grip */
  const q = $("#queue");
  function commitQueue() {
    const shown = $$(".qi", q).map((li) => li.dataset.key);
    const all = upNext();
    customQueue = [...shown.map((k) => all.find((x) => x.key === k)).filter(Boolean), ...all.filter((x) => !shown.includes(x.key))];
  }
  q.addEventListener("keydown", (e) => {
    const g = e.target.closest?.(".grip"); if (!g || !(e.key === "ArrowUp" || e.key === "ArrowDown")) return;
    e.preventDefault(); e.stopPropagation();
    const li = g.parentElement, sib = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    e.key === "ArrowUp" ? sib.before(li) : sib.after(li);
    g.focus(); commitQueue();
    toast(`Moved to position ${[...q.children].indexOf(li) + 1}`);
  });
  q.addEventListener("pointerdown", (e) => {
    const g = e.target.closest?.(".grip"); if (!g) return;
    e.preventDefault();
    const li = g.parentElement;
    g.setPointerCapture(e.pointerId);
    li.classList.add("lifted");
    const move = (ev) => {
      for (const o of q.children) {
        if (o === li) continue;
        const r = o.getBoundingClientRect();
        if (ev.clientY > r.top && ev.clientY < r.bottom) { ev.clientY < r.top + r.height / 2 ? o.before(li) : o.after(li); break; }
      }
    };
    const up = () => { g.removeEventListener("pointermove", move); li.classList.remove("lifted"); commitQueue(); };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up, { once: true });
    g.addEventListener("pointercancel", up, { once: true });
  });

  /* the bar's chapter label, repeat a part, sleep label and history, four times a second */
  let lastChap = null, lastRemember = 0;
  setInterval(() => {
    if (!P) return;
    if (abB != null && P.t >= abB) seekTo(abA);
    else if (abA != null && abB == null && P.t < abA - 0.5) { /* user went back before A: leave it */ }
    const c = chapters.length ? chapterAt(P.t) : null;
    if (c !== lastChap) {
      lastChap = c;
      $("#chap-name").textContent = c?.title || "";
      $$("#chap-list li").forEach((li, i) => li.classList.toggle("now", chapters[i] === c));
    }
    if ($("#chap-marks").childElementCount !== Math.max(0, chapters.length - 1) && P.d) drawMarks();
    if (sleepAt) sleepLabel();
    if (!P.paused && Date.now() - lastRemember > 5000) { lastRemember = Date.now(); remember(); }
    miniCheck();
  }, 250);
  addEventListener("pagehide", remember);

  function onLoad(it) {
    if (cur) remember();
    clearSubs();
    abA = abB = null; abUI();
    setChapters(it.chapters);
    lastChap = undefined;
    stage.classList.toggle("is-native", it.kind === "file" || it.kind === "hls" || it.kind === "dash");
    if (boost && it.kind !== "file" && it.kind !== "hls" && it.kind !== "dash") $("#m-boost").setAttribute("aria-checked", "false");
    if (customQueue) customQueue = customQueue.filter((x) => x.key !== it.key);
    renderCW();
  }
  video.addEventListener("loadedmetadata", () => { drawMarks(); abUI(); });

  /* offline shell: the page, styles, script, fonts and library work without a connection */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}));
  }

  return { onLoad, chapterAt, abSet, snapshot, sleepAtEnd, get state() { return { chapters: chapters.length, ab: [abA, abB], sleep: SLEEP[sleepIdx], boost, mini: wrap.classList.contains("mini"), fill: stage.classList.contains("fill"), subs: !!userTrack, queue: customQueue?.slice(0, 3).map((x) => x.key) }; } };
})();

/* ---------- boot ---------- */
async function boot() {
  syncVolUI(); syncRateUI(); syncToggles();
  $("#time").setAttribute("aria-label", prefs.remaining ? "Show elapsed time" : "Show time remaining");
  const [vids, hasClip, song] = await Promise.all([
    fetch(document.querySelector('link[rel="preload"][href^="videos.json"]')?.getAttribute("href") || "videos.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(CLIP.src, { method: "HEAD" }).then((r) => r.ok).catch(() => false),
    fetch("../player/contribution-song.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (vids?.channel) channel = { ...channel, ...vids.channel };
  $("#channel-link").href = channel.url;
  $("#channel-link").textContent = channel.handle;
  const yts = Array.isArray(vids?.videos) ? vids.videos.filter((v) => v && YT_ID.test(v.id)).map(ytItem) : [];
  if (song?.weeks?.length) {
    const tot = song.weeks.map((w) => w.days.reduce((a, b) => a + b, 0));
    let b = 0;
    tot.forEach((v, i) => { if (v >= tot[b]) b = i; });
    const d = new Date(song.weeks[b].start + "T00:00:00Z");
    CLIP.metaText = `15 seconds · week of ${d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, ${tot[b]} contributions`;
  }
  library = hasClip ? [CLIP, ...yts] : yts;
  renderLibrary();
  route();
}
function route() {
  const q = new URLSearchParams(location.search);
  const v = q.get("v"), t = +q.get("t") || 0;
  let it = null;
  if (v && v !== "clip") {
    const x = parseLink(v);
    if (x.error) say(`The shared link couldn't be played. ${x.error}`, true);
    else it = itemFromParsed(x);
    if (it && x.guessed && !x.via) probeLink(x).then((y) => { if (y.error) onError(y.error, x.src); else if (y.kind !== x.kind && cur?.src === x.src) load(itemFromParsed({ ...y, start: t || y.start }), { push: false }); });
  }
  it ||= library[0];
  if (!it) { $("#title").textContent = "Paste a video link below"; $("#eyebrow").textContent = ""; return; }
  if (t) it = { ...it, start: t };
  load(it, { play: false, push: false });
}
addEventListener("popstate", route);
boot();

// read-only state for automated tests
Object.defineProperty(window, "__vp", {
  value: Object.freeze({
    get state() {
      return { kind: cur?.kind, title: $("#title").textContent, t: P?.t, d: P?.d, paused: P?.paused, rate: prefs.rate, volume: prefs.volume, muted: prefs.muted, loop, ambient: amb.stats, extras: extras.state, error: stage.classList.contains("error") ? $("#notice-text").textContent : null };
    },
    parseLink,
  }),
});
