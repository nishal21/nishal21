// Contribution song player. No dependencies.
// Everything is drawn from contribution-song.json at load time, so the nightly rebuild
// changes the cover, lyrics, grid and numbers without touching this file.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const audio = $("#audio");
// what is playing: the <audio> element, or the remix engine once the stems are loaded (same interface)
let media = audio;
const playBtn = $("#play");
const seek = $("#seek");
const root = document.documentElement;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const wide = matchMedia("(min-width: 900px)");
const fmt = (t) => { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
const day = (iso, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", opts);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const INK = "#0d0e0c";
// Sleeve color per busiest month, Jan..Dec. Same table as SLEEVES in make_cover.py.
const SLEEVES = ["#a9d6f5", "#cbef4a", "#ff8a65", "#f6a6c6", "#7fe3b4", "#ffc53d",
  "#5cd6cf", "#ff9f43", "#c3b1ff", "#ff7a3d", "#e6d3a3", "#ff6b6b"];
const DAY_STEP = 1 / 8; // the generator plays day d at d/8 of the bar
// ?song=visitor plays the visitor song (scripts/visitor_song.py writes the same JSON shape); anything else is the contribution song
const SONG = new URLSearchParams(location.search).get("song") === "visitor" ? "visitor-song" : "contribution-song";
if (SONG !== "contribution-song") {
  document.body.classList.add("is-visitor");
  audio.src = `${SONG}.mp3`;
  $$('a.dl[href^="contribution-song."]').forEach((a) => {
    a.href = a.getAttribute("href").replace("contribution-song", SONG);
    a.download = a.download.replace("contribution-song", SONG);
  });
  $("#clip-dl")?.remove();
  $$(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === "./?song=visitor"));
  $$('.tabs a[aria-current]').forEach((a) => a.setAttribute("aria-current", "page"));
}

let song = null;
let ground = SLEEVES[1];
let dmax = 1;
let lineEls = [];   // .line buttons, same order as song.lines
let lineLabel = []; // the section name above a line, if the line opens a section
let lyEls = [];     // every moving row (section labels and lines)
let weekEls = [];
let cellEls = [];   // [week][day]
let padEls = [];    // [rule][day]
let curLine = -2, curOn = -2, curBar = -1, curSec = -1;
let lastT = 0;
let pulse = 0;

/* ---------- color scheme toggle: system by default, override stored only when it differs ---------- */
const schemeMeta = $('meta[name="color-scheme"]');
const sysDark = matchMedia("(prefers-color-scheme: dark)");
const rendered = () => (schemeMeta.content === "light dark" ? (sysDark.matches ? "dark" : "light") : schemeMeta.content);
const waveColors = new Map();
// low-end devices get a still backdrop (see .lite in player.css)
if ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4) document.documentElement.classList.add("lite");
function schemeChanged() { waveColors.clear(); setThemeColor(); drawWave(); drawBackdrop(); window.layoutDoodles?.(false); }
$("#theme").addEventListener("click", () => {
  const target = rendered() === "dark" ? "light" : "dark";
  const system = sysDark.matches ? "dark" : "light";
  try {
    if (target === system) localStorage.removeItem("color-scheme");
    else localStorage.setItem("color-scheme", target);
  } catch {}
  schemeMeta.content = target === system ? "light dark" : target;
  schemeChanged();
});
addEventListener("storage", (e) => { if (e.key === "color-scheme") { schemeMeta.content = e.newValue ?? "light dark"; schemeChanged(); } });
sysDark.addEventListener("change", schemeChanged);

// Resolve a custom property (which may hold light-dark()) to a real color for canvas.
const probe = document.createElement("i");
probe.style.display = "none";
document.body.append(probe);
const cssColor = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };

/* ---------- color: read the sleeve back from the cover and build the theme from it ---------- */
function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const hsl = (h, s, l) => `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
function luminance(css) {
  const [r, g, b] = cssColor(css).match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Most common non-ink color in the drawn cover (the sleeve), averaged.
function extractSleeve(canvas) {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(canvas, 0, 0, 24, 24);
  const px = x.getImageData(0, 0, 24, 24).data;
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (r + g + b < 120) continue; // the record itself
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const e = buckets.get(key) ?? [0, 0, 0, 0];
    e[0] += r; e[1] += g; e[2] += b; e[3]++;
    buckets.set(key, e);
  }
  const best = [...buckets.values()].sort((a, b) => b[3] - a[3])[0];
  return best ? best.slice(0, 3).map((v) => Math.round(v / best[3])) : hexToRgb(ground);
}

function applyPalette(rgb) {
  waveColors.clear();
  const [h, s] = rgbToHsl(rgb);
  const st = root.style;
  const g = `rgb(${rgb.join(" ")})`;
  const bgD = hsl(h, Math.min(s, 0.3), 0.065);
  const bgL = hsl(h, Math.min(s, 0.42), 0.925);
  // a darker cut of the sleeve that still reads on the light background
  let L = 0.42, deep = hsl(h, Math.min(1, s * 0.9), L);
  while (contrast(deep, bgL) < 4.5 && L > 0.08) { L -= 0.02; deep = hsl(h, Math.min(1, s * 0.9), L); }
  st.setProperty("--g", g);
  st.setProperty("--g-deep", deep);
  st.setProperty("--bg-d", bgD);
  st.setProperty("--bg-l", bgL);
  setThemeColor();
}
function setThemeColor() {
  const m = $('meta[name="theme-color"]');
  if (m) m.content = cssColor("var(--bg)");
}

/* ---------- looks: four ways to show the same player (layout and type live in player.css) ---------- */
// Vinyl is the record below. The others draw their own art here; the audio, lyrics and controls are shared.
// The choice is kept in localStorage, and #persona=<id> (on its own or after a remix link) opens a page in that look.
const PERSONAS = { vinyl: "Vinyl turntable", poster: "Poster", editorial: "Editorial", sketch: "Sketchbook" };
const lookFromHash = () => { const v = new URLSearchParams(location.hash.slice(1)).get("persona"); return v in PERSONAS ? v : null; };
const lookStored = () => { try { const v = localStorage.getItem("player-look"); return v in PERSONAS ? v : null; } catch { return null; } };
let persona = lookFromHash() || lookStored() || "vinyl";
let forceVinyl = false;
root.dataset.persona = persona;

function setPersona(p, { save = true, hash = true } = {}) {
  if (!(p in PERSONAS)) p = "vinyl";
  persona = p;
  root.dataset.persona = p;
  waveColors.clear();
  if (save) try { if (p === "vinyl") localStorage.removeItem("player-look"); else localStorage.setItem("player-look", p); } catch {}
  if (hash) {
    const parts = location.hash.slice(1).split("&").filter((x) => x && !x.startsWith("persona="));
    if (p !== "vinyl") parts.push(`persona=${p}`);
    try { history.replaceState(null, "", parts.length ? `#${parts.join("&")}` : location.pathname + location.search); } catch {}
  }
  $$('#looks input[name="look"]').forEach((r) => (r.checked = r.value === p));
  discImg = null;
  if (song) { drawSleeve(); drawWave(); layoutLyrics(true); update(true); backdropClock(); }
}
$$('#looks input[name="look"]').forEach((r) => {
  r.checked = r.value === persona;
  r.addEventListener("change", () => r.checked && setPersona(r.value));
});
// opening the picker puts focus on the current look, so the arrow keys move between them at once
$("#looks")?.addEventListener("toggle", (e) => { if (e.newState === "open") $('#looks input[name="look"]:checked')?.focus(); });
addEventListener("hashchange", () => { const p = lookFromHash(); if (p && p !== persona) setPersona(p, { hash: false }); });

// the cover drawers run every frame: resolve each colour once per look and scheme
const col = (v) => { const k = "c:" + v; let c = waveColors.get(k); if (c === undefined) { c = cssColor(v); waveColors.set(k, c); } return c; };
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, H, r) : x.rect(X, Y, W, H); }
const progressAt = (t) => clamp(t / (media.duration || song.length), 0, 1);

// Artwork for the looks: Open Doodles by Pablo Stanley (CC0) and a public domain letter for the handwriting.
// The SVGs are recoloured to each look's ink and accent; see art/CREDITS.txt.
const artSrc = {}, artImgs = {};
function art(name, ink, accent) {
  const key = `${name}|${ink}|${accent}`;
  if (artImgs[key]) return artImgs[key].complete ? artImgs[key] : null;
  if (!(name in artSrc)) {
    artSrc[name] = null;
    fetch(`art/${name}.svg`).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => { artSrc[name] = t; drawSleeve(); }).catch(() => {});
  }
  if (!artSrc[name]) return null;
  const svg = artSrc[name].replace('fill="#000"', `fill="${ink}"`).replace('fill="#FF5678"', `fill="${accent}"`);
  const img = new Image();
  img.onload = () => drawSleeve();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  artImgs[key] = img;
  return null;
}
let letter = null;
const letterTint = {};
function handwriting(color) {
  if (!letter) { letter = new Image(); letter.onload = () => drawSleeve(); letter.src = "art/handwriting.png"; }
  if (!letter.complete || !letter.naturalWidth) return null;
  if (!letterTint[color]) {
    const c = document.createElement("canvas");
    c.width = letter.naturalWidth; c.height = letter.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(letter, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    letterTint[color] = c;
  }
  return letterTint[color];
}
// draw an image to fill a box, keeping its shape (cover) or fitting inside it (contain)
function place(x, img, X, Y, W, H, mode = "contain") {
  const r = img.width / img.height, k = mode === "cover" ? Math.max(W / img.width, H / img.height) : Math.min(W / img.width, H / img.height);
  const w = img.width * k, h = img.height * k, dx = X + (W - w) / 2, dy = Y + (H - h) / 2;
  // a vector drawing is re-rasterised on every drawImage, and the covers redraw every frame while playing:
  // rasterise it once at this exact size and sub-pixel offset, then stamp the pixels at a whole-pixel position
  if (img instanceof HTMLImageElement && img.src.startsWith("data:image/svg") && x.getTransform().isIdentity && x.globalAlpha === 1) {
    const ix = Math.floor(dx), iy = Math.floor(dy), key = `${w}|${h}|${dx - ix}|${dy - iy}`;
    let c = rasters.get(img);
    if (!c || c.key !== key) {
      c = document.createElement("canvas");
      c.key = key; c.width = Math.ceil(dx - ix + w) + 1; c.height = Math.ceil(dy - iy + h) + 1;
      c.getContext("2d").drawImage(img, dx - ix, dy - iy, w, h);
      rasters.set(img, c);
    }
    x.drawImage(c, ix, iy);
    return r;
  }
  x.drawImage(img, dx, dy, w, h);
  return r;
}
const rasters = new WeakMap();

const posterFront = { key: "", c: document.createElement("canvas") };
const LOOKS = {
  // Poster: a flat colour field, handwriting behind, and the record sliding out of its sleeve as the song plays
  // Poster: the sleeve is all type. The title fills the width, the dancer stands on it, the record slides out on play.
  poster(x, W, H, t) {
    const field = col("var(--art-bg)"), ink = col("var(--fg)"), acc = col("var(--accent)");
    x.fillStyle = field; x.fillRect(0, 0, W, H);
    // record behind the right edge
    const target = reduceMotion.matches ? 0.12 : media.paused ? 0.04 : 0.16;
    slide += (target - slide) * (reduceMotion.matches ? 1 : 0.08);
    if (Math.abs(target - slide) > 0.002) requestAnimationFrame(() => drawSleeve());
    // the record stays inside the cover: tucked in when paused, its right edge at the cover edge when playing
    const E = W * 0.74, R = Math.min(H * 0.24, W * 0.24), out = clamp(slide / 0.16, 0, 1);
    const rx = E - R * 0.45 + out * (W * 0.985 - R - (E - R * 0.45)), ry = H * 0.3;
    x.fillStyle = col("var(--ink-panel)"); x.beginPath(); x.arc(rx, ry, R, 0, Math.PI * 2); x.fill();
    x.strokeStyle = col("color-mix(in oklab, var(--on-panel) 18%, transparent)"); x.lineWidth = Math.max(1, W / 800);
    for (let g = 0; g < 8; g++) { x.beginPath(); x.arc(rx, ry, R * (0.42 + g * 0.07), 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = acc === ink ? field : acc; x.beginPath(); x.arc(rx, ry, R * 0.3, 0, Math.PI * 2); x.fill();
    const turn = reduceMotion.matches ? 0 : t * 1.4;
    x.fillStyle = col("var(--ink-panel)"); x.beginPath(); x.arc(rx + Math.cos(turn) * R * 0.17, ry + Math.sin(turn) * R * 0.17, R * 0.04, 0, Math.PI * 2); x.fill();
    const hw = handwriting(col("color-mix(in oklab, var(--fg) 50%, transparent)"));
    const d = art("dancing", ink, acc === ink ? field : acc);
    // everything in front of the record is still: draw it once into a layer and stamp it each frame
    const key = `${W}x${H}|${field}|${ink}|${acc}|${!!hw}|${!!d}|${song.title}|${song.per}|${document.fonts.check("600 10px Bricolage")}`;
    if (posterFront.key !== key) {
      posterFront.key = key;
      const c = posterFront.c; c.width = W; c.height = H;
      // kept in the page next to the cover, so its text picks up the same inherited font settings
      if (!c.isConnected) { c.style.display = "none"; c.setAttribute("aria-hidden", "true"); sleeve.after(c); }
      const y = c.getContext("2d");
      // sleeve edge
      y.fillStyle = field; y.fillRect(0, 0, E, H);
      y.fillStyle = ink; y.fillRect(E - Math.max(1.5, W / 300), 0, Math.max(1.5, W / 300), H);
      // handwriting along the bottom
      if (hw) { y.save(); y.beginPath(); y.rect(0, H * 0.62, E, H * 0.38); y.clip(); place(y, hw, -W * 0.1, H * 0.5, W * 1.1, H * 0.7, "cover"); y.restore(); }
      // the title, as big as it fits
      y.fillStyle = ink; y.textBaseline = "alphabetic"; y.textAlign = "left";
      const words = song.title.toLowerCase().split(" ");
      let fs = H * 0.3;
      y.font = `600 ${fs}px Bricolage, sans-serif`;
      const widest = Math.max(...words.map((w) => y.measureText(w).width));
      fs = Math.min(fs, (fs * W * 0.64) / widest);
      y.font = `600 ${fs}px Bricolage, sans-serif`;
      y.letterSpacing = `${-fs * 0.05}px`;
      words.forEach((w, i) => y.fillText(w, W * 0.05, H * 0.06 + fs * 0.82 * (i + 1)));
      y.letterSpacing = "0px";
      y.font = `500 ${W * 0.03}px Bricolage, sans-serif`;
      y.fillText(`${song.bpm} bpm · ${String(song.key).toLowerCase()} · ${fmt(song.length)}`, W * 0.055, H * 0.06 + fs * 0.82 * words.length + W * 0.06);
      // the dancer, standing on the title
      if (d) place(y, d, W * 0.2, H * 0.38, W * 0.52, H * 0.6);  // still, inside the sleeve
      // sticker band
      y.save(); y.translate(W * 0.15, H * 0.9); y.rotate(-0.42);
      y.fillStyle = ink; roundRect(y, -W * 0.22, -W * 0.034, W * 0.44, W * 0.068, W * 0.034); y.fill();
      y.fillStyle = field; y.textAlign = "center"; y.textBaseline = "middle"; y.font = `500 ${W * 0.032}px Bricolage, sans-serif`;
      y.fillText(song.per === "bar" ? "made by visitors" : "rebuilt every night", 0, W * 0.003);
      y.restore();
    }
    x.drawImage(posterFront.c, 0, 0);
  },

  // Editorial: a magazine hero. Huge title on the left, words stepping down on the right, the figure in the rings.
  editorial(x, W, H, t) {
    x.fillStyle = col("var(--art-bg)"); x.fillRect(0, 0, W, H);
    const fg = col("var(--fg)"), dim = col("color-mix(in oklab, var(--fg) 25%, transparent)");
    const p = progressAt(t), cx = W * 0.7, cy = H * 0.6;
    x.strokeStyle = dim; x.lineWidth = Math.max(1, W / 700);
    for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(cx, cy, H * (0.2 + k * 0.1), 0, Math.PI * 2); x.stroke(); }
    x.strokeStyle = fg; x.lineWidth = Math.max(2, W / 350);
    x.beginPath(); x.arc(cx, cy, H * 0.5, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); x.stroke();
    const d = art("moshing", fg, col("var(--art-bg)"));
    if (d) place(x, d, W * 0.5, H * 0.28, W * 0.48, H * 0.7);
    // the stepped words: section names, each repeated a little further in
    x.fillStyle = fg; x.textBaseline = "top"; x.textAlign = "left";
    const fsS = H * 0.04;
    x.font = `400 ${fsS}px Bricolage, sans-serif`;
    const names = [...new Set(song.sections.map((s) => s.name.replace(/ \d+$/, "")))].slice(0, 5);
    x.textAlign = "right";
    names.forEach((n, i) => x.fillText(names.slice(Math.max(0, i - 1), i + 1).join(" & ").toLowerCase(), W * 0.72 + i * W * 0.05, H * 0.05 + i * fsS * 1.2));
    x.textAlign = "left";
    // the hero title
    const words = song.title.split(" ");
    let fs = H * 0.26;
    x.font = `600 ${fs}px Bricolage, sans-serif`;
    fs = Math.min(fs, (fs * W * 0.58) / Math.max(...words.map((w) => x.measureText(w + "*").width)));  // stays clear of the dancer
    x.font = `600 ${fs}px Bricolage, sans-serif`;
    x.letterSpacing = `${-fs * 0.05}px`;
    x.textBaseline = "alphabetic";
    words.forEach((w, i) => x.fillText(w + (i === words.length - 1 ? "*" : ""), W * 0.04, H * 0.3 + fs * 0.8 + i * fs * 0.88));
    x.letterSpacing = "0px";
    x.font = `400 ${H * 0.045}px Bricolage, sans-serif`;
    x.fillText(song.per === "bar" ? "Is a song made one note at a time" : `Is ${song.stats.total} contributions`, W * 0.045, H * 0.3 + fs * 0.8 + (words.length - 1) * fs * 0.88 + H * 0.08);
    x.fillText(song.per === "bar" ? "by people who visit this profile." : "turned into a song, rebuilt nightly.", W * 0.045, H * 0.3 + fs * 0.8 + (words.length - 1) * fs * 0.88 + H * 0.14);
  },

  // Sketchbook: a sleeve drawn in ink on paper, with a record outline, a stamp and the dancer in colour
  sketch(x, W, H, t) {
    const paper = col("var(--paper)"), ink = col("var(--fg)"), card = col("var(--art-bg)"), acc = col("var(--accent)");
    x.fillStyle = col("var(--bg)"); x.fillRect(0, 0, W, H);
    x.fillStyle = card; roundRect(x, 0, 0, W, H, W * 0.06); x.fill();
    // paper sleeve with a double ink frame
    const m = W * 0.06;
    x.fillStyle = paper; roundRect(x, m, m, W - 2 * m, H - 2 * m, W * 0.025); x.fill();
    x.strokeStyle = ink; x.lineWidth = Math.max(1.5, W / 220); x.stroke();
    x.lineWidth = Math.max(1, W / 600); roundRect(x, m * 1.4, m * 1.4, W - 2.8 * m, H - 2.8 * m, W * 0.015); x.stroke();
    // a record drawn in outline, turning slowly
    const rx = W * 0.66, ry = H * 0.6, R = W * 0.26, turn = reduceMotion.matches ? 0 : t * 0.8;
    x.lineWidth = Math.max(1, W / 500);
    for (let g = 0; g < 5; g++) { x.beginPath(); x.arc(rx, ry, R * (0.35 + g * 0.16), turn + g, turn + g + Math.PI * 1.7); x.stroke(); }
    x.fillStyle = acc; x.beginPath(); x.arc(rx, ry, R * 0.22, 0, Math.PI * 2); x.fill(); x.stroke();
    // title in heavy capitals
    x.fillStyle = ink; x.textBaseline = "top"; x.textAlign = "left";
    const tw = song.title.toUpperCase().split(" ");
    let tf = W * 0.105;
    x.font = `800 ${tf}px Bricolage, sans-serif`;
    tf = Math.min(tf, (tf * (W - 3.8 * m)) / Math.max(...tw.map((w) => x.measureText(w).width)));
    x.font = `800 ${tf}px Bricolage, sans-serif`;
    tw.forEach((w, i) => x.fillText(w, m * 1.9, m * 1.9 + i * tf * 0.95));
    // stamp
    x.save(); x.translate(W - m * 3.2, H - m * 3.2); x.rotate(0.2);
    x.beginPath(); x.arc(0, 0, W * 0.075, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(0, 0, W * 0.062, 0, Math.PI * 2); x.stroke();
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = `700 ${W * 0.03}px Bricolage, sans-serif`;
    x.fillText(String(song.bpm), 0, -W * 0.012); x.font = `600 ${W * 0.018}px Bricolage, sans-serif`; x.fillText("BPM", 0, W * 0.02);
    x.restore();
    const d = art("groovy", ink, acc);  // still: the cover never moves the figure
    if (d) place(x, d, W * 0.1, H * 0.3, W * 0.7, H * 0.62);
    x.fillStyle = ink; x.font = `700 ${W * 0.032}px Bricolage, sans-serif`; x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.fillText(`SIDE A · ${sectionAt(t).name.toUpperCase()}`, m * 1.9, H - m * 1.9);
  },
};
let slide = 0.22;

/* ---------- the cover: a record whose grooves are the year ---------- */
const sleeve = $("#sleeve");
let discImg = null;    // pre-rendered record, redrawn only when the size changes
let sleeveSize = 0;

// canvas sizes are cached and refreshed by a ResizeObserver, so per-frame drawing never forces a layout
const boxes = new WeakMap();
const boxWatch = new ResizeObserver((list) => { for (const e of list) boxes.set(e.target, e.target.getBoundingClientRect()); });
function fitCanvas(c, cap = 2) {
  let r = boxes.get(c);
  if (!r) { r = c.getBoundingClientRect(); boxes.set(c, r); boxWatch.observe(c); }
  const dpr = Math.min(devicePixelRatio || 1, cap);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return [c.getContext("2d"), w, h, dpr];
}

// geometry shared with make_cover.py: record 80% of the side, nudged 6% right and down
const geo = (S) => {
  const D = S * 0.8, cx = S * 0.56, cy = S * 0.56, R = (D / 2) * 0.985;
  return { D, cx, cy, R, r0: 0.40, r1: 0.92, label: R * 0.31 };
};
function dotRoom(R, rr, n, r0, r1) { return Math.min((rr * 2 * Math.PI) / n, (R * (r1 - r0)) / 6) * 0.46; }

function renderDisc(S) {
  const { D, R, r0, r1, label } = geo(S);
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(D);
  const x = c.getContext("2d");
  const m = D / 2;
  x.fillStyle = INK;
  x.beginPath(); x.arc(m, m, R, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "rgba(255,255,255,0.055)";
  x.lineWidth = Math.max(0.6, S / 1200);
  for (let g = 0; g < 60; g++) { const r = R * (0.34 + (0.64 * g) / 59); x.beginPath(); x.arc(m, m, r, 0, Math.PI * 2); x.stroke(); }
  const weeks = song.weeks, n = weeks.length;
  const dim = mix(INK, ground, 0.3);
  weeks.forEach((w, i) => {
    const a = ((-90 + ((i + 0.5) * 360) / n) * Math.PI) / 180;
    for (let d = 0; d < 7; d++) {
      const rr = R * (r0 + (d * (r1 - r0)) / 6);
      const room = dotRoom(R, rr, n, r0, r1);
      const cnt = w.days[d] ?? 0;
      const px = m + rr * Math.cos(a), py = m + rr * Math.sin(a);
      x.fillStyle = cnt ? ground : dim;
      const dr = cnt ? room * (0.38 + 0.62 * Math.sqrt(cnt / dmax)) : room * 0.16;
      x.beginPath(); x.arc(px, py, dr, 0, Math.PI * 2); x.fill();
    }
    // a short tick on the outer rim for weeks with a release, PR, new repo or the peak day
    if (w.events?.length) {
      const span = (Math.PI * 2) / n;
      x.strokeStyle = w.events.some((e) => e.type === "release" || e.type === "peak") ? ground : mix(INK, ground, 0.6);
      x.lineWidth = Math.max(1.2, R * 0.016);
      x.lineCap = "round";
      x.beginPath(); x.arc(m, m, R * 0.962, a - span * 0.3, a + span * 0.3); x.stroke();
    }
  });
  return c;
}
// The center label stays upright while the record turns, so the number is always readable.
function drawLabel(x, cx, cy, label) {
  x.fillStyle = ground;
  x.beginPath(); x.arc(cx, cy, label, 0, Math.PI * 2); x.fill();
  x.fillStyle = INK;
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `800 ${Math.round(label * 0.62)}px Bricolage, sans-serif`;
  x.fillText(String(song.stats.total), cx, cy + label * 0.04);
  x.font = `650 ${Math.max(6, Math.round(label * 0.13))}px Bricolage, sans-serif`;
  x.fillText("NISHAL K", cx, cy - label * 0.52);
  x.fillText(`${(song.unit || "contribution").toUpperCase()}S`, cx, cy + label * 0.52);
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(" ")})`;
}

// rotation of the record in degrees: the playing week sits at 12 o'clock under the needle
const turnAt = (t) => (reduceMotion.matches ? 0 : -((t / song.bar - 0.5) * 360) / song.weeks.length);

function drawSleeve(t = media.currentTime) {
  if (!song) return;
  const [x, S, SH] = fitCanvas(sleeve, 2.5);
  if (persona !== "vinyl" && !forceVinyl) { LOOKS[persona](x, S, SH, t); return; }
  if (S !== sleeveSize || !discImg) { sleeveSize = S; discImg = renderDisc(S); }
  const { D, cx, cy, R, r0, r1, label } = geo(S);
  const n = song.weeks.length;
  const pos = t / song.bar;                       // weeks elapsed, fractional
  const turn = turnAt(t);
  x.fillStyle = ground;
  x.fillRect(0, 0, S, S);
  // sleeve type
  x.fillStyle = INK;
  x.textBaseline = "top"; x.textAlign = "left";
  const m = S * 0.05;
  x.font = `800 ${S * 0.052}px Bricolage, sans-serif`;
  const [t1, t2] = song.per === "bar" ? ["Visitor", "song"] : ["Contribution", "song"];
  x.fillText(t1, m, m);
  x.fillText(t2, m, m + S * 0.056);
  x.font = `600 ${S * 0.02}px Bricolage, sans-serif`;
  x.textAlign = "right";
  x.fillText(`${song.bpm} BPM`, S - m, m + S * 0.008);
  x.fillText(String(song.key).toUpperCase(), S - m, m + S * 0.036);
  x.textAlign = "left"; x.textBaseline = "alphabetic";
  x.fillText((song.per === "bar" ? "ONE NOTE PER VISITOR" : `${day(song.stats.first, { month: "short", year: "numeric" })} to ${day(song.stats.last, { month: "short", year: "numeric" })}`.toUpperCase()), m, S - m);
  // record, turned so the bar that's playing sits at 12 o'clock under the needle
  x.save();
  x.translate(cx, cy);
  x.rotate((turn * Math.PI) / 180);
  x.drawImage(discImg, -D / 2, -D / 2, D, D);
  // light up the week that's playing
  const bar = clamp(Math.floor(pos), 0, n - 1);
  if (t > 0 || !media.paused) {
    const a = ((-90 + ((bar + 0.5) * 360) / n) * Math.PI) / 180;
    const frac = pos - Math.floor(pos);
    for (let d = 0; d < 7; d++) {
      const cnt = song.weeks[bar].days[d] ?? 0;
      const rr = R * (r0 + (d * (r1 - r0)) / 6);
      const room = dotRoom(R, rr, n, r0, r1);
      const since = frac - d * DAY_STEP;
      const hit = !media.paused && cnt && since >= 0 && since < 0.12 ? 1 - since / 0.12 : 0;
      const dr = (cnt ? room * (0.38 + 0.62 * Math.sqrt(cnt / dmax)) : room * 0.2) * (1 + hit * 0.7);
      x.fillStyle = cnt ? "#fff" : "rgba(255,255,255,0.45)";
      x.beginPath(); x.arc(rr * Math.cos(a), rr * Math.sin(a), dr, 0, Math.PI * 2); x.fill();
    }
  }
  x.restore();
  drawLabel(x, cx, cy, label);
  // needle (only meaningful when the record turns)
  if (!reduceMotion.matches) {
    const top = cy - R;
    x.fillStyle = INK;
    x.beginPath();
    x.moveTo(cx - S * 0.012, top - S * 0.03); x.lineTo(cx + S * 0.012, top - S * 0.03); x.lineTo(cx, top - S * 0.006);
    x.closePath(); x.fill();
  }
}

/* ---------- the record is a turntable: click a spoke to play that week, drag around it to scratch ---------- */
// pointer position on the record: angle (degrees, screen frame) and distance as a share of the record radius
function discPoint(e) {
  const r = sleeve.getBoundingClientRect();
  const { cx, cy, R } = geo(r.width);
  const dx = e.clientX - r.left - cx, dy = e.clientY - r.top - cy;
  return { ang: (Math.atan2(dy, dx) * 180) / Math.PI, dist: Math.hypot(dx, dy) / R };
}
function weekAtAngle(ang, t = media.currentTime) {
  const n = song.weeks.length;
  const local = (((ang - turnAt(t) + 90) % 360) + 360) % 360; // undo the turn, 0 at 12 o'clock
  return clamp(Math.floor((local * n) / 360), 0, n - 1);
}
let scratch = null;
sleeve.addEventListener("pointerdown", (e) => {
  if (!song || e.button > 0) return;
  if (persona !== "vinyl") { // the other looks have no record to scratch: a click plays or pauses
    if (media.paused) play(); else media.pause();
    return;
  }
  const p = discPoint(e);
  if (p.dist > 1 || p.dist < 0.31) return; // only the grooves, not the label or the sleeve
  e.preventDefault();
  sleeve.setPointerCapture(e.pointerId);
  scratch = { id: e.pointerId, x: e.clientX, y: e.clientY, ang: p.ang, moved: false, wasPlaying: !media.paused, t0: media.currentTime };
});
sleeve.addEventListener("pointermove", (e) => {
  if (!song) return;
  if (!scratch || e.pointerId !== scratch.id) {
    const p = discPoint(e);
    sleeve.classList.toggle("on-disc", p.dist <= 1 && p.dist >= 0.31);
    return;
  }
  if (!scratch.moved && Math.hypot(e.clientX - scratch.x, e.clientY - scratch.y) < 5) return;
  if (!scratch.moved) {
    scratch.moved = true;
    sleeve.classList.add("scratching");
    if (scratch.wasPlaying) media.pause();
  }
  const ang = discPoint(e).ang;
  let da = ang - scratch.ang;
  if (da > 180) da -= 360; else if (da < -180) da += 360;
  scratch.ang = ang;
  // the record follows the hand: turning it back (counterclockwise) moves forward in time, like the platter does
  const d = media.duration || song.length;
  const dt = (-da / 360) * song.weeks.length * song.bar;
  media.currentTime = clamp(media.currentTime + dt, 0, Math.max(0, d - 0.05));
  lastT = media.currentTime;
  update(true);
});
function endScratch(e) {
  if (!scratch || e.pointerId !== scratch.id) return;
  const s = scratch;
  scratch = null;
  sleeve.classList.remove("scratching");
  if (e.type === "pointercancel") { if (s.wasPlaying) play(); return; }
  if (!s.moved) {
    const p = discPoint(e);
    jump(weekAtAngle(p.ang, s.t0) * song.bar + 0.01);
    play();
  } else if (s.wasPlaying) play();
}
sleeve.addEventListener("pointerup", endScratch);
sleeve.addEventListener("pointercancel", endScratch);
sleeve.addEventListener("pointerleave", () => { if (!scratch) sleeve.classList.remove("on-disc"); });
// keyboard: the record is a slider over the weeks
sleeve.addEventListener("keydown", (e) => {
  if (!song || e.altKey || e.ctrlKey || e.metaKey) return;
  const n = song.weeks.length;
  const bar = clamp(Math.floor(media.currentTime / song.bar), 0, n - 1);
  const to = { ArrowRight: bar + 1, ArrowUp: bar + 1, ArrowLeft: bar - 1, ArrowDown: bar - 1, PageUp: bar + 4, PageDown: bar - 4, Home: 0, End: n - 1 }[e.key];
  if (to !== undefined) {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { jump(media.currentTime + (e.key === "ArrowLeft" ? -1 : 1)); return; }
    jump(clamp(to, 0, n - 1) * song.bar + 0.01);
  } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); play(); }
});

// Backdrop: the cover at 40px, blurred and scaled up by CSS, turning slowly.
// In light mode the black record is remapped to a pale cut of the sleeve so the page stays bright.
// The blur is baked into the canvas once, instead of a CSS blur that the browser redoes on a huge layer every frame.
const bgSrc = document.createElement("canvas");
bgSrc.width = bgSrc.height = 40;
function drawBackdrop() {
  if (!song) return;
  const bg = $("#bg");
  const x = bgSrc.getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, 40, 40);
  x.filter = "blur(2px)";
  x.drawImage(sleeve, -4, -4, 48, 48);
  x.filter = "none";
  if (rendered() === "light") {
    const [h, s] = rgbToHsl(hexToRgb(ground));
    const pale = cssColor(hsl(h, Math.min(1, s * 0.6), 0.86)).match(/[\d.]+/g).map(Number);
    const g = hexToRgb(ground);
    const img = x.getImageData(0, 0, 40, 40), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = Math.min(1, (d[i] + d[i + 1] + d[i + 2]) / (g[0] + g[1] + g[2])); // 0 on the record, 1 on the sleeve
      for (let c = 0; c < 3; c++) d[i + c] = pale[c] + (g[c] - pale[c]) * k;
    }
    x.putImageData(img, 0, 0);
  }
  // same look as CSS blur(28px) saturate(1.15) on a 150vmax square, scaled to this canvas
  const N = bgBaked.width, css = 1.5 * Math.max(innerWidth, innerHeight), o = bgBaked.getContext("2d");
  o.clearRect(0, 0, N, N);
  o.filter = `blur(${(28 * N / css).toFixed(2)}px) saturate(1.15)`;
  o.imageSmoothingQuality = "high";
  o.drawImage(bgSrc, 0, 0, N, N);
  o.filter = "none";
  bgStep = -1;
  turnBackdrop();
}
// The baked square turns inside the upright #bg canvas: one turn in 120 s, in 1200 steps of 0.3 deg.
// Held still on low-end devices and with reduced motion, as the CSS animation it replaces was.
const bgBaked = document.createElement("canvas");
bgBaked.width = bgBaked.height = 160;
const bgT0 = performance.now();
let bgStep = -1, bgTimer = 0;
const bgStill = () => document.documentElement.classList.contains("lite") || reduceMotion.matches;
function turnBackdrop() {
  if (!song) return;
  const step = bgStill() ? 0 : Math.floor((performance.now() - bgT0) / 100) % 1200;
  if (step === bgStep) return;
  bgStep = step;
  const bg = $("#bg"), o = bg.getContext("2d"), W = bg.width;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, W, W);
  o.translate(W / 2, W / 2);
  o.rotate(step * 0.3 * Math.PI / 180);
  o.imageSmoothingQuality = "high";
  o.drawImage(bgBaked, -80, -80);
  o.setTransform(1, 0, 0, 1, 0, 0);
}
function backdropClock() {
  clearInterval(bgTimer);
  const on = !bgStill() && !document.hidden && getComputedStyle($("#bg")).display !== "none";
  if (on) bgTimer = setInterval(turnBackdrop, 100);
}
document.addEventListener("visibilitychange", backdropClock);
reduceMotion.addEventListener("change", () => { bgStep = -1; turnBackdrop(); backdropClock(); });

/* ---------- waveform scrubber ---------- */
const waveEl = $(".wave");
let hoverP = -1;
let liveBins = null;
// colours for the waveform come from inside the scrubber, so a look can give it its own panel colours
const waveProbe = document.createElement("i");
waveProbe.style.display = "none";
$(".wave").append(waveProbe);
// resolved colours are cached until the look or colour scheme changes (getComputedStyle every frame forces a style pass)
const waveColor = (v) => {
  let c = waveColors.get(v);
  if (c === undefined) { waveProbe.style.color = v; c = getComputedStyle(waveProbe).color; waveColors.set(v, c); }
  return c;
};
function drawLine(x, w, h, dpr, p, d) {
  const y = h / 2, fg = waveColor("var(--fg)"), dim = waveColor("color-mix(in oklab, var(--fg) 22%, transparent)");
  x.fillStyle = dim; x.fillRect(0, y - dpr, w, 2 * dpr);
  song.sections.slice(1).forEach((s) => { x.fillRect((s.start / d) * w - dpr / 2, y - 5 * dpr, dpr, 10 * dpr); });
  x.fillStyle = fg; x.fillRect(0, y - 1.5 * dpr, w * p, 3 * dpr);
  if (hoverP >= 0) { x.fillStyle = waveColor("color-mix(in oklab, var(--fg) 50%, transparent)"); x.fillRect(w * Math.min(p, hoverP), y - dpr, Math.abs(hoverP - p) * w, 2 * dpr); }
}
function drawWave() {
  if (media.getFrequency && !liveBins) liveBins = new Uint8Array(128);
  if (!song) return;
  const c = $("#wave");
  const [x, w, h, dpr] = fitCanvas(c);
  x.clearRect(0, 0, w, h);
  const peaks = song.peaks;
  const d = media.duration || song.length;
  const p = clamp(media.currentTime / d, 0, 1);
  // each look has its own scrubber: thin poster bars, a single editorial line, chunky sketchbook bars
  if (persona === "editorial") { drawLine(x, w, h, dpr, p, d); return; }
  const [bw, bg] = { poster: [1.5, 2.5], sketch: [6, 4] }[persona] || [3, 2];
  const barW = bw * dpr, gap = bg * dpr;
  const count = Math.max(10, Math.floor((w + gap) / (barW + gap)));
  const step = (w + gap) / count;
  const on = waveColor(persona === "poster" ? "var(--wave-on, var(--fg))" : "var(--fg)");
  const off = waveColor("color-mix(in oklab, var(--fg) 24%, transparent)");
  const pre = waveColor("color-mix(in oklab, var(--fg) 52%, transparent)");
  const cuts = song.sections.slice(1).map((s) => s.start / d);
  // while the remix engine plays, the bars around the playhead breathe with the live spectrum (lows at the playhead)
  const live = !reduceMotion.matches && !media.paused && media.getFrequency ? media.getFrequency(liveBins) : null;
  const reach = 14; // bars each side of the playhead
  for (let i = 0; i < count; i++) {
    const a = i / count, b = (i + 1) / count;
    if (cuts.some((k) => k >= a && k < b)) continue; // a gap at each section change
    let v = 0;
    const s0 = Math.floor(a * peaks.length), s1 = Math.max(s0 + 1, Math.floor(b * peaks.length));
    for (let k = s0; k < s1 && k < peaks.length; k++) v = Math.max(v, peaks[k]);
    let bh = Math.max(3 * dpr, Math.pow(v, 0.85) * h * 0.92);
    if (live) {
      const k = Math.abs((a + b) / 2 - p) * count;
      if (k < reach) {
        const bin = Math.min(live.length - 1, Math.floor((k / reach) ** 1.5 * live.length * 0.7));
        bh = Math.min(h, bh * (1 + 0.28 * (1 - k / reach) * (live[bin] / 255)));
      }
    }
    const mid = (a + b) / 2;
    x.fillStyle = mid <= p ? on : hoverP >= 0 && mid <= hoverP ? pre : off;
    x.beginPath();
    x.roundRect(i * step, (h - bh) / 2, barW, bh, barW / 2);
    x.fill();
  }
}
waveEl.addEventListener("pointermove", (e) => {
  if (!song || e.pointerType === "touch") return;
  const r = waveEl.getBoundingClientRect();
  hoverP = clamp((e.clientX - r.left) / r.width, 0, 1);
  const t = hoverP * (media.duration || song.length);
  waveEl.style.setProperty("--h", hoverP);
  $("#tip").textContent = `${fmt(t)} · ${sectionAt(t).name}`;
  waveEl.classList.add("hovering");
  drawWave();
});
const endHover = () => { if (hoverP < 0) return; hoverP = -1; waveEl.classList.remove("hovering"); drawWave(); };
waveEl.addEventListener("pointerleave", endHover);
// scrolling moves the waveform out from under a still pointer without a pointerleave
addEventListener("scroll", endHover, { passive: true });

/* ---------- build the page from the song data ---------- */
const sectionAt = (t) => { let s = song.sections[0]; for (const x of song.sections) if (t >= x.start - 0.01) s = x; return s; };
const sectionIndex = (t) => { let k = 0; song.sections.forEach((x, i) => { if (t >= x.start - 0.01) k = i; }); return k; };

// run startup work one piece per task, in order, so input and paint can get in between
const stageQ = [];
function stage(fn) {
  stageQ.push(fn);
  if (stageQ.length === 1) setTimeout(runStage, 0);
}
function runStage() {
  const fn = stageQ[0];
  try { fn(); } finally { stageQ.shift(); if (stageQ.length) setTimeout(runStage, 0); }
}

function build(data) {
  song = data;
  const s = data.stats;
  dmax = Math.max(1, ...data.weeks.flatMap((w) => w.days));
  ground = SLEEVES[(parseInt(String(s.month).slice(5, 7), 10) || 2) - 1];

  if (data.title) { $("#title").textContent = data.title; document.title = `${data.title} · Nishal K`; }
  if (data.artist && SONG !== "contribution-song") $(".artist a").textContent = data.artist;
  if (data.about) {
    const p = $(".about .prose p");
    p.textContent = data.about + " ";
    if (data.add) { const a = document.createElement("a"); a.href = data.add; a.textContent = "Add your note"; p.append(a, "."); }
    $('.about .prose a[href$="contribution_song.py"]')?.setAttribute("href", "https://github.com/nishal21/nishal21/blob/main/scripts/visitor_song.py");
  }
  if (data.per === "bar") {
    $("#year-h").textContent = "The song in beats";
    $(".year .block-head p").textContent = "Each column is one bar of the song and its four beats. Select a bar to play from there.";
    $("#range").textContent = "So far";
  }
  $("#left").textContent = `-${fmt(data.length)}`;
  $("#where").textContent = `${fmt(data.length)} · ${data.bpm} BPM · ${data.key}`;
  $("#gen").textContent = `Last built ${new Date(data.generated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST`;
  if (data.per !== "bar") $("#range").textContent = `${day(s.first)} to ${day(s.last)}`;

  buildLyrics(data);
  sleeve.setAttribute("aria-valuemax", data.weeks.length);
  setupMediaSession(data);
  // the sections below the player are built in separate tasks, so the first paint isn't held up on slow phones
  stage(() => { buildGrid(data); buildPads(data); update(true); });
  stage(() => { buildStats(s, data.items); buildTracklist(data); update(true); });

  playBtn.disabled = false;
  seek.disabled = false;
  $("#prev").disabled = false;
  $("#next").disabled = false;
  document.body.classList.add("ready");

  document.fonts.load("800 40px Bricolage").catch(() => {}).finally(() => {
    discImg = null;
    // the palette always comes from the record sleeve, whichever look is showing
    stage(() => { forceVinyl = true; drawSleeve(); applyPalette(extractSleeve(sleeve)); forceVinyl = false; });
    stage(() => { drawSleeve(); drawBackdrop(); backdropClock(); });
    stage(() => { layoutLyrics(true); update(true); });
  });
  update(true);
}

/* lyrics */
function buildLyrics(data) {
  const box = $("#lyrics");
  let last = null;
  data.lines.forEach((l, i) => {
    lineLabel[i] = null;
    if (l.section !== last) {
      last = l.section;
      const h = document.createElement("p");
      h.className = "ly ly-sec";
      h.setAttribute("aria-hidden", "true");
      h.textContent = l.section;
      box.append(h);
      lyEls.push(h);
      lineLabel[i] = h;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ly line";
    const inner = document.createElement("span");
    // spread the line's sung time over its words by length, so the sweep follows the voice
    const words = l.text.split(/\s+/).filter(Boolean);
    const weights = words.map((w) => w.replace(/[^\w]/g, "").length + 1.5);
    const total = weights.reduce((a, c) => a + c, 0);
    let acc = 0;
    words.forEach((w, k) => {
      const sp = document.createElement("span");
      sp.className = "w";
      sp.textContent = w;
      sp.dataset.a = acc / total;
      acc += weights[k];
      sp.dataset.b = acc / total;
      inner.append(sp, k < words.length - 1 ? " " : "");
    });
    b.append(inner);
    b.setAttribute("aria-label", `${l.text}, at ${fmt(l.t)}`);
    b.addEventListener("click", () => { if (dragMoved) return; jump(Math.max(0, l.t - 0.05)); play(); });
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) browseTo(i); });
    box.append(b);
    b.style.setProperty("--k", i % 5); // the editorial look steps each line further in
    lyEls.push(b);
    lineEls.push(b);
  });
}

const pane = $("#lyrics-pane");
let tops = [];       // offsetTop of each moving row
let browse = null;   // manual offset while the reader scrolls the lyrics
let browseTimer = 0;
let dragMoved = false;

function layoutLyrics(force) {
  tops = lyEls.map((el) => el.offsetTop + el.offsetHeight / 2);
  placeLyrics(force);
}
function anchorY() { return pane.clientHeight * (wide.matches ? 0.36 : 0.3); }
function lineIndexAt(t) {
  let idx = -1;
  for (let i = 0; i < song.lines.length; i++) if (t >= song.lines[i].t - 0.08) idx = i;
  return idx;
}
function placeLyrics(instant) {
  if (!lyEls.length || !pane.clientHeight) return;
  const active = Math.max(0, curLine);
  const activeEl = lineEls[active];
  const ai = lyEls.indexOf(activeEl);
  const base = browse ?? (anchorY() - tops[ai]);
  lyEls.forEach((el, i) => {
    const k = i - ai;
    el.style.setProperty("--y", `${base.toFixed(1)}px`);
    el.style.setProperty("--d", instant || browse !== null || k <= 0 ? "0ms" : `${Math.min(6, k) * 38}ms`);
  });
  lineEls.forEach((el, i) => {
    const dist = Math.abs(i - Math.max(0, curLine));
    el.style.setProperty("--blur", `${Math.min(3.2, dist * 0.8).toFixed(1)}px`);
  });
  dispatchEvent(new Event("lyricsmove"));
  if (instant) {
    lyEls.forEach((el) => (el.style.transition = "none"));
    void pane.offsetHeight;
    lyEls.forEach((el) => (el.style.transition = ""));
  }
}
function setBrowse(y) {
  const minY = anchorY() - tops[tops.length - 1];
  const maxY = anchorY() - tops[0];
  browse = clamp(y, minY - 40, maxY + 40);
  pane.classList.add("browsing");
  placeLyrics(false);
  clearTimeout(browseTimer);
  browseTimer = setTimeout(endBrowse, 2800);
}
function endBrowse() { browse = null; pane.classList.remove("browsing"); placeLyrics(false); }
function browseTo(lineIdx) {
  const ai = lyEls.indexOf(lineEls[lineIdx]);
  setBrowse(anchorY() - tops[ai]);
}
pane.addEventListener("wheel", (e) => {
  if (!tops.length) return;
  e.preventDefault();
  const cur = browse ?? (anchorY() - tops[lyEls.indexOf(lineEls[Math.max(0, curLine)])]);
  setBrowse(cur - e.deltaY);
}, { passive: false });
let drag = null;
pane.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || !tops.length) return;
  const cur = browse ?? (anchorY() - tops[lyEls.indexOf(lineEls[Math.max(0, curLine)])]);
  drag = { y: e.clientY, from: cur };
  dragMoved = false;
});
pane.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 8) dragMoved = true;
  if (dragMoved) { pane.classList.add("dragging"); setBrowse(drag.from + dy); }
});
const endDrag = () => { drag = null; pane.classList.remove("dragging"); setTimeout(() => (dragMoved = false), 0); };
pane.addEventListener("pointerup", endDrag);
pane.addEventListener("pointercancel", endDrag);

function setWait(i, v) { (lineLabel[i] ?? lineEls[i]).classList.toggle("wait", v); }

/* year grid */
function eventText(e) {
  if (e.type === "release") return `release: ${e.repo} ${e.title}`;
  if (e.type === "pr") return `merged PR in ${e.repo}`;
  if (e.type === "repo") return `new repo: ${e.repo}`;
  return "busiest day of the year";
}
// colors from GitHub's linguist for the languages that show up; anything else gets a stable hue from its name
const LANG_COLORS = { TypeScript: "#3178c6", JavaScript: "#f1e05a", HTML: "#e34c26", CSS: "#563d7c", Go: "#00add8", Rust: "#dea584",
  Python: "#3572a5", MDX: "#fcb32c", Kotlin: "#a97bff", Java: "#b07219", Dart: "#00b4ab", "C++": "#f34b7d", C: "#555555",
  Shell: "#89e051", Svelte: "#ff3e00", Vue: "#41b883", Swift: "#f05138", Lua: "#000080", "C#": "#178600", PHP: "#4f5d95" };
function langColor(l) {
  if (LANG_COLORS[l]) return LANG_COLORS[l];
  let h = 0; for (const ch of l) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 50%)`;
}
function eventLabel(e) {
  if (e.type === "release") return `Release: ${e.title?.startsWith(e.repo) ? e.title : `${e.repo} ${e.title ?? ""}`.trim()}`;
  if (e.type === "pr") return `Merged PR: ${e.repo}`;
  if (e.type === "repo") return `New repo: ${e.repo}`;
  return "Busiest day of the year";
}
const badge = $("#now-badge");
let badgeBar = -1;
function renderBadge(bar, live) {
  if (bar === badgeBar) return;
  badgeBar = bar;
  badge.replaceChildren();
  const w = song.weeks[bar];
  if (!w) return;
  const chip = (cls, text, i) => {
    const s = document.createElement("span");
    s.className = `chip ${cls}`;
    s.style.setProperty("--i", i);
    s.textContent = text;
    badge.append(s);
    return s;
  };
  let i = 0;
  if (w.lang) {
    const c = chip("lang", w.lang, i++);
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = langColor(w.lang);
    c.prepend(dot);
  }
  const ev = [...(w.events || [])].sort((a, b) => ["peak", "release", "pr", "repo"].indexOf(a.type) - ["peak", "release", "pr", "repo"].indexOf(b.type));
  // one line: the main event, then a count for the rest (listed in its tooltip)
  if (ev.length) chip(`ev ev-${ev[0].type}`, eventLabel(ev[0]), i++).title = eventLabel(ev[0]);
  if (ev.length > 1) chip("more", `+${ev.length - 1}`, i++).title = ev.slice(1).map(eventLabel).join("\n");
  badge.classList.toggle("live", !!live);
  // re-trigger the entrance animation
  badge.classList.remove("in"); void badge.offsetWidth; badge.classList.add("in");
}

function level(c) { return c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / dmax) * 4)); }
function buildGrid(data) {
  const wrap = $("#weeks"), months = $("#months");
  $("#grid-scroll").style.setProperty("--cols", data.weeks.length);
  let lastMonth = -1, lastLabel = -9;
  data.weeks.forEach((w, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wk";
    b.tabIndex = i === 0 ? 0 : -1;
    const total = w.days.reduce((a, c) => a + c, 0);
    const notes = [w.lang ? `mostly ${w.lang}` : "", ...(w.events || []).map(eventText)].filter(Boolean).join("; ");
    const what = data.per === "bar" ? `Bar ${i + 1}` : `Week of ${day(w.start)}`, unit = data.unit || "contribution";
    b.setAttribute("aria-label", `${what}, ${total} ${unit}${total === 1 ? "" : "s"}${notes ? `, ${notes}` : ""}. Play from here.`);
    b.title = `${what}: ${total} ${unit}${total === 1 ? "" : "s"}${notes ? `\n${notes}` : ""}`;
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const c = document.createElement("span");
      c.className = "c";
      c.dataset.l = level(w.days[d] ?? 0);
      b.append(c);
      cells.push(c);
    }
    b.addEventListener("click", () => { jump(i * data.bar + 0.01); play(); });
    b.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1, Home: -999, End: 999 }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const j = clamp(i + k, 0, weekEls.length - 1);
      weekEls.forEach((el, n) => (el.tabIndex = n === j ? 0 : -1));
      weekEls[j].focus();
    });
    wrap.append(b);
    weekEls.push(b);
    cellEls.push(cells);
    const mo = w.start ? new Date(w.start + "T00:00:00").getMonth() : lastMonth; // the lead-in bar has no date
    if (mo !== lastMonth) {
      // label the first week that starts in a new month, if there's room
      if (i - lastLabel >= 4 && i < data.weeks.length - 2) {
        const sp = document.createElement("span");
        sp.style.setProperty("--i", i);
        sp.textContent = day(w.start, { month: "short" });
        months.append(sp);
        lastLabel = i;
      }
      lastMonth = mo;
    }
  });
}

/* drum pads for the bar that's playing */
const RULE_NAMES = { kick: "Kick", hat: "Hat", snare: "Snare", clap: "Clap" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// One-shot drum previews, synthesized so the pads work before (or without) the remix stems.
// Tuned to the song: a short low kick on A, tight hats, a dry snare and a three-slap clap.
let padCtx = null;
let noiseBuf = null;
function drumCtx() {
  if (!padCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    padCtx = new AC();
    noiseBuf = padCtx.createBuffer(1, padCtx.sampleRate, padCtx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  if (padCtx.state === "suspended") padCtx.resume();
  return padCtx;
}
function playDrum(name, vel = 1) {
  const ac = drumCtx();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.55 * vel;
  out.connect(ac.destination);
  const env = (node, peak, decay, at = t) => {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    node.connect(g); g.connect(out);
    return g;
  };
  const noise = (at, dur) => { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.start(at, Math.random() * 0.5); s.stop(at + dur); return s; };
  const filt = (type, f, q = 0.8) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  if (name === "kick") {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12); // settles on A1
    env(o, 1, 0.42);
    o.start(t); o.stop(t + 0.45);
  } else if (name === "hat") {
    const f = filt("highpass", 7500);
    noise(t, 0.06).connect(f);
    env(f, 0.5, 0.055);
  } else if (name === "snare") {
    const f = filt("bandpass", 1900, 0.7);
    noise(t, 0.2).connect(f);
    env(f, 0.8, 0.18);
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t); // A3
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    env(o, 0.45, 0.1);
    o.start(t); o.stop(t + 0.12);
  } else {
    const f = filt("bandpass", 1250, 1.1);
    [0, 0.011, 0.022].forEach((d) => { noise(t + d, 0.01).connect(f); });
    env(f, 0.9, 0.2, t + 0.022);
    const pre = filt("bandpass", 1250, 1.1);
    [0, 0.011].forEach((d) => noise(t + d, 0.008).connect(pre));
    env(pre, 0.7, 0.02);
  }
  setTimeout(() => out.disconnect(), 800);
}
function hitPad(p) {
  playDrum(p.dataset.rule, p.classList.contains("on") ? 1 : 0.75);
  p.classList.remove("hit");
  void p.offsetWidth;
  p.classList.add("hit");
}
function buildPads(data) {
  const pads = $("#pads");
  pads.append(document.createElement("span"));
  ["S", "M", "T", "W", "T", "F", "S"].forEach((d) => {
    const s = document.createElement("span");
    s.className = "day";
    s.textContent = d;
    pads.append(s);
  });
  const rules = [...data.rules].sort((a, b) => b.min - a.min); // loudest rule on top, kick at the bottom
  rules.forEach((r) => {
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.textContent = RULE_NAMES[r.name] ?? r.name;
    pads.append(lab);
    const row = [];
    for (let d = 0; d < 7; d++) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = "pad";
      p.dataset.min = r.min;
      p.dataset.rule = r.name;
      p.tabIndex = padEls.length === 0 && d === 0 ? 0 : -1;
      p.setAttribute("aria-label", `${RULE_NAMES[r.name] ?? r.name}, ${DAY_NAMES[d]}. Preview`);
      const rowIdx = padEls.length;
      p.addEventListener("click", () => hitPad(p));
      p.addEventListener("keydown", (e) => {
        const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
        if (!mv) return;
        e.preventDefault(); e.stopPropagation();
        const ri = clamp(rowIdx + mv[0], 0, padEls.length - 1), di = clamp(d + mv[1], 0, 6);
        padEls.flat().forEach((el) => (el.tabIndex = -1));
        padEls[ri][di].tabIndex = 0;
        padEls[ri][di].focus();
      });
      pads.append(p);
      row.push(p);
    }
    padEls.push(row);
  });
  const asc = [...data.rules].sort((a, b) => a.min - b.min);
  $("#rules").textContent = (data.per === "bar" ? "Each beat lights up when a visitor's note lands on it." : "Each day plays " + asc.map((r, i) => `${i === asc.length - 1 ? "and " : ""}a ${r.name} at ${r.min}+`).join(", ") + " contributions.");
}

function buildStats(s, custom) {
  if (custom) return fillStats(custom);
  const month = new Date(s.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const items = [
    ["Contributions", s.total, `${day(s.first, { month: "short", year: "numeric" })} to ${day(s.last, { month: "short", year: "numeric" })}`],
    ["Active days", s.active, `out of ${s.days}`],
    ["Best day", s.best_n, day(s.best)],
    ["Busiest month", s.month_n, month],
    ["Longest streak", `${s.streak} days`, `${day(s.streak_start, { month: "short", day: "numeric" })} to ${day(s.streak_end)}`],
  ];
  if (s.recent?.length) items.push(["Working on", s.recent[0], s.recent.slice(1).join(", "), true]);
  fillStats(items);
}
function fillStats(items) {
  const dl = $("#stats");
  for (const [k, v, small, word] of items) {
    const div = document.createElement("div");
    const dt = document.createElement("dt"), dd = document.createElement("dd"), sm = document.createElement("small");
    dt.textContent = k;
    dd.textContent = v;
    if (word) dd.className = "word";
    sm.textContent = small;
    div.append(dt, dd, sm);
    dl.append(div);
  }
}

function buildTracklist(data) {
  const ol = $("#tracklist");
  data.sections.forEach((sec, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="n"></span><span class="name"></span><span class="t"></span>';
    $(".n", b).textContent = String(i + 1).padStart(2, "0");
    $(".name", b).textContent = sec.name;
    $(".t", b).textContent = fmt(sec.start);
    b.addEventListener("click", () => { jump(sec.start + 0.01); play(); });
    li.append(b);
    ol.append(li);
  });
}

/* ---------- playback ---------- */
const mediaHandlers = [];
function onMedia(ev, fn) {
  mediaHandlers.push([ev, fn]);
  audio.addEventListener(ev, (e) => { if (media === audio) fn(e); });
}
// hand playback over to another source (the remix engine), keeping the position and play state
function useMedia(next) {
  if (next === media) return;
  const t = media.currentTime, wasPlaying = !media.paused;
  if (next !== audio) for (const [ev, fn] of mediaHandlers) next.addEventListener(ev, (e) => { if (media === next) fn(e); });
  const prev = media;
  media = next;
  prev.pause();
  media.currentTime = t;
  lastT = t;
  if (wasPlaying) play();
  update(true);
}
async function play() {
  try { await media.play(); } catch (e) { if (e.name !== "AbortError") console.warn("Playback was blocked:", e.message); }
}
function toggle() { media.paused ? play() : media.pause(); }
function jump(t) {
  const d = media.duration || song?.length || 0;
  media.currentTime = clamp(t, 0, Math.max(0, d - 0.05));
  lastT = media.currentTime;
  update(true);
}
function skipSection(dir) {
  const t = media.currentTime, k = sectionIndex(t);
  if (dir < 0 && t - song.sections[k].start > 2) return jump(song.sections[k].start + 0.01);
  const j = clamp(k + dir, 0, song.sections.length - 1);
  jump(song.sections[j].start + 0.01);
}

// Play button shape: a squircle at rest, a nine-lobe cookie while playing.
function shape(fn) {
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r = fn(a);
    pts.push(`${(50 + r * Math.cos(a) * 50).toFixed(2)}% ${(50 + r * Math.sin(a) * 50).toFixed(2)}%`);
  }
  return `polygon(${pts.join(",")})`;
}
const SQUIRCLE = shape((a) => { const n = 4; return 0.98 / Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), 1 / n) * 0.93; });
const COOKIE = shape((a) => 0.9 + 0.08 * Math.cos(9 * a));
playBtn.style.setProperty("--shape", SQUIRCLE);

playBtn.addEventListener("click", toggle);
$("#prev").addEventListener("click", () => skipSection(-1));
$("#next").addEventListener("click", () => skipSection(1));
onMedia("play", () => {
  document.body.classList.add("playing");
  playBtn.setAttribute("aria-label", "Pause");
  playBtn.style.setProperty("--shape", COOKIE);
  lastT = media.currentTime;
  if (!looping) { looping = true; requestAnimationFrame(loop); }
});
onMedia("pause", () => {
  document.body.classList.remove("playing");
  playBtn.setAttribute("aria-label", "Play");
  playBtn.style.setProperty("--shape", SQUIRCLE);
  setKick(0);
  update(true);
});
onMedia("ended", () => { media.currentTime = 0; update(true); });
onMedia("timeupdate", () => { if (media.paused) update(); });
onMedia("seeked", () => { lastT = media.currentTime; update(true); });
onMedia("loadedmetadata", () => update(true));
// the share clip is built nightly; hide its link if this build doesn't have one
fetch("share-clip.mp4", { method: "HEAD" }).then((r) => { if (!r.ok) $("#clip-dl").hidden = true; })
  .catch(() => { $("#clip-dl").hidden = true; });
audio.addEventListener("error", () => { $("#where").textContent = "Couldn't load the audio. The MP3 download may still work."; });
seek.addEventListener("input", () => jump((seek.value / 1000) * (media.duration || song.length)));

document.addEventListener("keydown", (e) => {
  if (!song || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t.closest("textarea, select, [contenteditable]")) return;
  if (t !== seek && t.closest('input, [role="slider"], [role="radio"]') && /^(Arrow|Home|End|Page)/.test(e.key)) return;
  if (t.closest("button, a, summary") && (e.key === " " || e.key === "Enter")) return; // let controls act normally
  const k = e.key.toLowerCase();
  if (k === " " || k === "k") { e.preventDefault(); toggle(); }
  else if (e.key === "ArrowLeft" && t !== seek) { e.preventDefault(); e.shiftKey ? skipSection(-1) : jump(media.currentTime - 5); }
  else if (e.key === "ArrowRight" && t !== seek) { e.preventDefault(); e.shiftKey ? skipSection(1) : jump(media.currentTime + 5); }
  else if (e.key === "Home" && t !== seek) { e.preventDefault(); jump(0); }
  else if (k === "y" && !e.shiftKey) { toggleLyricsView(); }
});

/* small screens: lyrics (or the remix desk) replace the cover, with the cover shrinking into the header row.
   On wide screens the lyrics are always shown and the remix desk takes their place while it's open. */
const lyricsBtn = $("#lyrics-toggle");
const panelWatchers = [];
let panel = null;
function setPanel(which) {
  if (which === "lyrics" && wide.matches) which = null;
  if (which === panel) return;
  panel = which;
  const apply = () => {
    document.body.classList.toggle("lyrics-mode", which === "lyrics");
    document.body.classList.toggle("remix-open", which === "remix");
    lyricsBtn.setAttribute("aria-pressed", String(which === "lyrics"));
    discImg = null;
    drawSleeve();
    layoutLyrics(true);
    panelWatchers.forEach((fn) => fn(which));
  };
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(apply);
  else apply();
  if (which && !wide.matches) scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
}
function toggleLyricsView(force) {
  if (wide.matches) return;
  const on = force ?? panel !== "lyrics";
  setPanel(on ? "lyrics" : panel === "lyrics" ? null : panel);
}
lyricsBtn.addEventListener("click", () => toggleLyricsView());
wide.addEventListener("change", () => { if (wide.matches && panel === "lyrics") setPanel(null); layoutLyrics(true); });

/* ---------- per-frame updates ---------- */
function setKick(v) {
  $(".backdrop").style.setProperty("--kick", v.toFixed(3));
  playBtn.style.setProperty("--kick", v.toFixed(3));
}

function fireHits(from, to) {
  // day hits whose step fell between the last frame and this one
  if (to < from || to - from > 0.5) return;
  const n = song.weeks.length;
  for (let b = Math.floor(from / song.bar); b <= Math.floor(to / song.bar) && b < n; b++) {
    for (let d = 0; d < 7; d++) {
      const at = (b + d * DAY_STEP) * song.bar;
      const c = song.weeks[b]?.days[d] ?? 0;
      if (at > from && at <= to && c) {
        pulse = Math.max(pulse, 0.35 + 0.65 * Math.sqrt(c / dmax));
        if (!reduceMotion.matches) {
          const el = cellEls[b]?.[d];
          if (!el) continue;
          // restart the flash without forcing a layout
          const run = el.classList.contains("hit") ? el.getAnimations() : [];
          if (run.length) run.forEach((an) => { an.currentTime = 0; an.play(); });
          else { el.classList.remove("hit"); requestAnimationFrame(() => el.classList.add("hit")); }
        }
      }
    }
  }
}

function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
function update(force) {
  if (!song) return;
  const t = media.currentTime;
  const d = media.duration || song.length;
  const p = clamp(t / d, 0, 1);
  // only touch the DOM when a value actually changes (these run every frame while playing)
  setText($("#cur"), fmt(t));
  setText($("#left"), `-${fmt(d - t)}`);
  const sv = Math.round(p * 1000);
  if (+seek.value !== sv) seek.value = sv;
  const vt = `${fmt(t)} of ${fmt(d)}, ${sectionAt(t).name}`;
  if (seek.getAttribute("aria-valuetext") !== vt) seek.setAttribute("aria-valuetext", vt);
  waveEl.style.setProperty("--p", p);

  // lyrics: the sung line lights up; between lines (intro, instrumental bars) the next line waits
  const L = song.lines;
  const idx = lineIndexAt(t);
  const next = L[idx + 1];
  const gap = idx < 0 || (t > L[idx].end + 0.6 && (!next || next.t - t > 1));
  const on = gap ? -1 : idx;
  const anchor = gap ? Math.min(idx + 1, L.length - 1) : idx;
  const waiting = gap && next && !media.paused ? idx + 1 : -1;
  if (on !== curOn || anchor !== curLine || force) {
    lineEls.forEach((el, i) => {
      el.classList.toggle("on", i === on);
      setWait(i, i === waiting);
      if (i === on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
    });
    const jumped = Math.abs(anchor - curLine) > 1;
    curLine = anchor;
    curOn = on;
    if (browse === null) placeLyrics(force === true && jumped);
  } else {
    lineEls.forEach((el, i) => setWait(i, i === waiting));
  }
  if (on >= 0) {
    const l = L[on];
    const lp = clamp((t - l.t) / Math.max(0.2, l.end - l.t), 0, 1);
    for (const w of lineEls[on].querySelectorAll(".w")) {
      const a = +w.dataset.a, b = +w.dataset.b;
      const wp = clamp((lp - a) / (b - a), 0, 1);
      const ws = wp.toFixed(3);
      if (w.style.getPropertyValue("--wp") !== ws) w.style.setProperty("--wp", ws);
      w.classList.toggle("sung", wp >= 1);
    }
  }

  // bar, week and section
  const n = song.weeks.length;
  const bar = clamp(Math.floor(t / song.bar), 0, n - 1);
  if (bar !== curBar || force) {
    weekEls.forEach((el, i) => { el.classList.toggle("now", i === bar && (t > 0 || !media.paused)); el.classList.toggle("ahead", i > bar); });
    curBar = bar;
    const w = song.weeks[bar];
    const total = w.days.reduce((a, c) => a + c, 0);
    padEls.forEach((row) => row.forEach((pad, dd) => {
      const c = w.days[dd] ?? 0;
      pad.classList.toggle("on", c >= +pad.dataset.min);
      pad.style.setProperty("--o", (0.45 + 0.55 * Math.min(1, c / dmax)).toFixed(2));
    }));
    const unit = song.unit || "contribution";
    const when = song.per === "bar" ? "" : w.start ? `Week of ${day(w.start)} · ` : "Before the first week · ";
    const label = `${when}${total} ${unit}${total === 1 ? "" : "s"}`;
    $("#bar-week").textContent = `Bar ${bar + 1} of ${n}. ${label}${w.lang ? ` · mostly ${w.lang}` : ""}`;
    $("#pads").setAttribute("aria-label", `Drum pads. ${label}`);
    const playing = t > 0 || !media.paused;
    if (playing) $("#where").textContent = `${sectionAt(t).name} · ${song.per === "bar" ? `bar ${bar + 1}` : w.start ? day(w.start, { month: "short", day: "numeric" }) : "intro"}${w.lang ? ` · ${w.lang}` : ""}`;
    renderBadge(bar, playing);
    sleeve.setAttribute("aria-valuenow", bar + 1);
    sleeve.setAttribute("aria-valuetext", `${label}${w.events?.length ? `, ${w.events.map(eventLabel).join(", ")}` : ""}`);
    // keep the playing week in view in the scrollable grid, unless the reader is using it
    const gs = $("#grid-scroll");
    if (!media.paused && gs.scrollWidth > gs.clientWidth && !gs.matches(":hover, :focus-within")) {
      const el = weekEls[bar];
      const target = el.offsetLeft - gs.clientWidth / 2;
      gs.scrollTo({ left: target, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  }
  const step = Math.floor(((t / song.bar) % 1) / DAY_STEP);
  padEls.forEach((row) => row.forEach((pad, dd) => pad.classList.toggle("step", !media.paused && dd === step)));

  const sec = sectionIndex(t);
  if (sec !== curSec || force) {
    $$("#tracklist li").forEach((li, i) => (i === sec ? li.setAttribute("aria-current", "true") : li.removeAttribute("aria-current")));
    curSec = sec;
  }
  // canvases scrolled out of view are not redrawn; they catch up when they come back
  if (inView.wave) drawWave();
  if (inView.sleeve) drawSleeve(t);
}
const inView = { wave: true, sleeve: true };
const viewWatch = new IntersectionObserver((list) => {
  for (const e of list) {
    const k = e.target === sleeve ? "sleeve" : "wave";
    const was = inView[k];
    inView[k] = e.isIntersecting;
    if (e.isIntersecting && !was) k === "sleeve" ? drawSleeve() : drawWave();
  }
});
viewWatch.observe(sleeve);
viewWatch.observe($("#wave"));

let looping = false;
function loop() {
  if (media.paused) { looping = false; return; }
  const t = media.currentTime;
  fireHits(lastT, t);
  lastT = t;
  if (!reduceMotion.matches) {
    const pk = song.peaks[Math.min(song.peaks.length - 1, Math.floor((t / (media.duration || song.length)) * song.peaks.length))] ?? 0;
    pulse *= 0.88;
    setKick(Math.min(1, pulse * 0.75 + pk * 0.25));
  }
  update();
  requestAnimationFrame(loop);
}

/* ---------- lock screen and media keys ---------- */
function setupMediaSession(data) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: data.title, artist: data.artist, album: `${data.stats.total} ${data.unit || "contribution"}s`,
    artwork: [{ src: new URL("cover.png", location.href).href, sizes: "512x512", type: "image/png" }],
  });
  const handlers = {
    play: () => play(),
    pause: () => media.pause(),
    seekto: (e) => jump(e.seekTime),
    seekbackward: (e) => jump(media.currentTime - (e.seekOffset || 5)),
    seekforward: (e) => jump(media.currentTime + (e.seekOffset || 5)),
    previoustrack: () => skipSection(-1),
    nexttrack: () => skipSection(1),
  };
  for (const [k, fn] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
  const pos = () => {
    if (!media.duration || !navigator.mediaSession.setPositionState) return;
    try { navigator.mediaSession.setPositionState({ duration: media.duration, position: media.currentTime, playbackRate: media.playbackRate }); } catch {}
  };
  ["loadedmetadata", "seeked", "play", "pause", "ratechange"].forEach((ev) => onMedia(ev, pos));
}

/* ---------- misc ---------- */
fetch(`${SONG}.mp3`, { method: "HEAD" })
  .then((r) => { const n = +r.headers.get("content-length"); if (r.ok && n) $("#mp3-size").textContent = `${(n / 1048576).toFixed(1)} MB`; })
  .catch(() => {});

let resizeRaf = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { drawWave(); drawSleeve(); layoutLyrics(true); });
}).observe(document.body);
reduceMotion.addEventListener("change", () => { discImg = null; update(true); });

let songReady;
// what remix.js uses to plug into the player
window.songPlayer = {
  ready: new Promise((r) => (songReady = r)),
  get song() { return song; },
  get media() { return media; },
  use: (m) => useMedia(m),
  setPanel,
  get panel() { return panel; },
  onPanel: (fn) => panelWatchers.push(fn),
};

fetch(`${SONG}.json`, { credentials: "same-origin" })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((data) => {
    build(data);
    // ?t=42 starts the song there (the cover's "Copy link at" uses it)
    const t0 = parseFloat(new URLSearchParams(location.search).get("t"));
    if (t0 > 0) jump(t0);
    songReady(song);
  })
  .catch((e) => { $("#where").textContent = "Couldn't load the song data. The MP3 download still works."; console.error(e); });
