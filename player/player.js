// Contribution song player. No dependencies.
// Everything is drawn from contribution-song.json at load time, so the nightly rebuild
// changes the cover, lyrics, grid and numbers without touching this file.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const audio = $("#audio");
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
function schemeChanged() { setThemeColor(); drawWave(); drawBackdrop(); }
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

/* ---------- the cover: a record whose grooves are the year ---------- */
const sleeve = $("#sleeve");
let discImg = null;    // pre-rendered record, redrawn only when the size changes
let sleeveSize = 0;

function fitCanvas(c, cap = 2) {
  const r = c.getBoundingClientRect();
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
  // a soft sheen, like light on vinyl
  if (x.createConicGradient) {
    const sh = x.createConicGradient(-Math.PI / 4, m, m);
    sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.08, "rgba(255,255,255,0.07)"); sh.addColorStop(0.16, "rgba(255,255,255,0)");
    sh.addColorStop(0.5, "rgba(255,255,255,0)"); sh.addColorStop(0.58, "rgba(255,255,255,0.05)"); sh.addColorStop(0.66, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sh; x.beginPath(); x.arc(m, m, R, 0, Math.PI * 2); x.fill();
  }
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
  x.fillText("CONTRIBUTIONS", cx, cy + label * 0.52);
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(" ")})`;
}

function drawSleeve(t = audio.currentTime) {
  if (!song) return;
  const [x, S] = fitCanvas(sleeve, 2.5);
  if (S !== sleeveSize || !discImg) { sleeveSize = S; discImg = renderDisc(S); }
  const { D, cx, cy, R, r0, r1, label } = geo(S);
  const n = song.weeks.length;
  const pos = t / song.bar;                       // weeks elapsed, fractional
  const turn = reduceMotion.matches ? 0 : -((pos - 0.5) * 360) / n;
  x.fillStyle = ground;
  x.fillRect(0, 0, S, S);
  // sleeve type
  x.fillStyle = INK;
  x.textBaseline = "top"; x.textAlign = "left";
  const m = S * 0.05;
  x.font = `800 ${S * 0.052}px Bricolage, sans-serif`;
  x.fillText("Contribution", m, m);
  x.fillText("song", m, m + S * 0.056);
  x.font = `600 ${S * 0.02}px Bricolage, sans-serif`;
  x.textAlign = "right";
  x.fillText(`${song.bpm} BPM`, S - m, m + S * 0.008);
  x.fillText(String(song.key).toUpperCase(), S - m, m + S * 0.036);
  x.textAlign = "left"; x.textBaseline = "alphabetic";
  x.fillText(`${day(song.stats.first, { month: "short", year: "numeric" })} to ${day(song.stats.last, { month: "short", year: "numeric" })}`.toUpperCase(), m, S - m);
  // record, turned so the bar that's playing sits at 12 o'clock under the needle
  x.save();
  x.translate(cx, cy);
  x.rotate((turn * Math.PI) / 180);
  x.drawImage(discImg, -D / 2, -D / 2, D, D);
  // light up the week that's playing
  const bar = clamp(Math.floor(pos), 0, n - 1);
  if (t > 0 || !audio.paused) {
    const a = ((-90 + ((bar + 0.5) * 360) / n) * Math.PI) / 180;
    const frac = pos - Math.floor(pos);
    for (let d = 0; d < 7; d++) {
      const cnt = song.weeks[bar].days[d] ?? 0;
      const rr = R * (r0 + (d * (r1 - r0)) / 6);
      const room = dotRoom(R, rr, n, r0, r1);
      const since = frac - d * DAY_STEP;
      const hit = !audio.paused && cnt && since >= 0 && since < 0.12 ? 1 - since / 0.12 : 0;
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

// Backdrop: the cover at 40px, blurred and scaled up by CSS, turning slowly.
// In light mode the black record is remapped to a pale cut of the sleeve so the page stays bright.
function drawBackdrop() {
  if (!song) return;
  const bg = $("#bg");
  const x = bg.getContext("2d", { willReadFrequently: true });
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
}

/* ---------- waveform scrubber ---------- */
const waveEl = $(".wave");
let hoverP = -1;
function drawWave() {
  if (!song) return;
  const c = $("#wave");
  const [x, w, h, dpr] = fitCanvas(c);
  x.clearRect(0, 0, w, h);
  const peaks = song.peaks;
  const d = audio.duration || song.length;
  const p = clamp(audio.currentTime / d, 0, 1);
  const barW = 3 * dpr, gap = 2 * dpr;
  const count = Math.max(10, Math.floor((w + gap) / (barW + gap)));
  const step = (w + gap) / count;
  const on = cssColor("var(--fg)");
  const off = cssColor("color-mix(in oklab, var(--fg) 24%, transparent)");
  const pre = cssColor("color-mix(in oklab, var(--fg) 52%, transparent)");
  const cuts = song.sections.slice(1).map((s) => s.start / d);
  for (let i = 0; i < count; i++) {
    const a = i / count, b = (i + 1) / count;
    if (cuts.some((k) => k >= a && k < b)) continue; // a gap at each section change
    let v = 0;
    const s0 = Math.floor(a * peaks.length), s1 = Math.max(s0 + 1, Math.floor(b * peaks.length));
    for (let k = s0; k < s1 && k < peaks.length; k++) v = Math.max(v, peaks[k]);
    const bh = Math.max(3 * dpr, Math.pow(v, 0.85) * h * 0.92);
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
  const t = hoverP * (audio.duration || song.length);
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

function build(data) {
  song = data;
  const s = data.stats;
  dmax = Math.max(1, ...data.weeks.flatMap((w) => w.days));
  ground = SLEEVES[(parseInt(String(s.month).slice(5, 7), 10) || 2) - 1];

  $("#left").textContent = `-${fmt(data.length)}`;
  $("#where").textContent = `${fmt(data.length)} · ${data.bpm} BPM · ${data.key}`;
  $("#gen").textContent = `Last built ${new Date(data.generated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST`;
  $("#range").textContent = `${day(s.first)} to ${day(s.last)}`;

  buildLyrics(data);
  buildGrid(data);
  buildPads(data);
  buildStats(s);
  buildTracklist(data);
  setupMediaSession(data);

  playBtn.disabled = false;
  seek.disabled = false;
  $("#prev").disabled = false;
  $("#next").disabled = false;
  document.body.classList.add("ready");

  document.fonts.load("800 40px Bricolage").catch(() => {}).finally(() => {
    discImg = null;
    drawSleeve();
    applyPalette(extractSleeve(sleeve));
    drawBackdrop();
    layoutLyrics(true);
    update(true);
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
    b.setAttribute("aria-label", `Week of ${day(w.start)}, ${total} contributions${notes ? `, ${notes}` : ""}. Play from here.`);
    b.title = `Week of ${day(w.start)}: ${total} contributions${notes ? `\n${notes}` : ""}`;
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
    const mo = new Date(w.start + "T00:00:00").getMonth();
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
      const p = document.createElement("span");
      p.className = "pad";
      p.dataset.min = r.min;
      pads.append(p);
      row.push(p);
    }
    padEls.push(row);
  });
  const asc = [...data.rules].sort((a, b) => a.min - b.min);
  $("#rules").textContent = "Each day plays " + asc.map((r, i) => `${i === asc.length - 1 ? "and " : ""}a ${r.name} at ${r.min}+`).join(", ") + " contributions.";
}

function buildStats(s) {
  const month = new Date(s.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const items = [
    ["Contributions", s.total, `${day(s.first, { month: "short", year: "numeric" })} to ${day(s.last, { month: "short", year: "numeric" })}`],
    ["Active days", s.active, `out of ${s.days}`],
    ["Best day", s.best_n, day(s.best)],
    ["Busiest month", s.month_n, month],
    ["Longest streak", `${s.streak} days`, `${day(s.streak_start, { month: "short", day: "numeric" })} to ${day(s.streak_end)}`],
  ];
  if (s.recent?.length) items.push(["Working on", s.recent[0], s.recent.slice(1).join(", "), true]);
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
async function play() {
  try { await audio.play(); } catch (e) { if (e.name !== "AbortError") console.warn("Playback was blocked:", e.message); }
}
function toggle() { audio.paused ? play() : audio.pause(); }
function jump(t) {
  const d = audio.duration || song?.length || 0;
  audio.currentTime = clamp(t, 0, Math.max(0, d - 0.05));
  lastT = audio.currentTime;
  update(true);
}
function skipSection(dir) {
  const t = audio.currentTime, k = sectionIndex(t);
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
audio.addEventListener("play", () => {
  document.body.classList.add("playing");
  playBtn.setAttribute("aria-label", "Pause");
  playBtn.style.setProperty("--shape", COOKIE);
  lastT = audio.currentTime;
  requestAnimationFrame(loop);
});
audio.addEventListener("pause", () => {
  document.body.classList.remove("playing");
  playBtn.setAttribute("aria-label", "Play");
  playBtn.style.setProperty("--shape", SQUIRCLE);
  setKick(0);
  update(true);
});
audio.addEventListener("ended", () => { audio.currentTime = 0; update(true); });
audio.addEventListener("timeupdate", () => { if (audio.paused) update(); });
audio.addEventListener("seeked", () => { lastT = audio.currentTime; update(true); });
audio.addEventListener("loadedmetadata", () => update(true));
// the share clip is built nightly; hide its link if this build doesn't have one
fetch("share-clip.mp4", { method: "HEAD" }).then((r) => { if (!r.ok) $("#clip-dl").hidden = true; })
  .catch(() => { $("#clip-dl").hidden = true; });
audio.addEventListener("error", () => { $("#where").textContent = "Couldn't load the audio. The MP3 download may still work."; });
seek.addEventListener("input", () => jump((seek.value / 1000) * (audio.duration || song.length)));

document.addEventListener("keydown", (e) => {
  if (!song || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t.closest("textarea, select, [contenteditable]")) return;
  if (t.closest("button, a, summary") && (e.key === " " || e.key === "Enter")) return; // let controls act normally
  const k = e.key.toLowerCase();
  if (k === " " || k === "k") { e.preventDefault(); toggle(); }
  else if (e.key === "ArrowLeft" && t !== seek) { e.preventDefault(); e.shiftKey ? skipSection(-1) : jump(audio.currentTime - 5); }
  else if (e.key === "ArrowRight" && t !== seek) { e.preventDefault(); e.shiftKey ? skipSection(1) : jump(audio.currentTime + 5); }
  else if (e.key === "Home" && t !== seek) { e.preventDefault(); jump(0); }
  else if (k === "y" && !e.shiftKey) { toggleLyricsView(); }
});

/* small screens: lyrics replace the cover, with the cover shrinking into the header row */
const lyricsBtn = $("#lyrics-toggle");
function toggleLyricsView(force) {
  if (wide.matches) return;
  const on = force ?? !document.body.classList.contains("lyrics-mode");
  const apply = () => {
    document.body.classList.toggle("lyrics-mode", on);
    lyricsBtn.setAttribute("aria-pressed", String(on));
    discImg = null;
    drawSleeve();
    layoutLyrics(true);
  };
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(apply);
  else apply();
  if (on) scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
}
lyricsBtn.addEventListener("click", () => toggleLyricsView());
wide.addEventListener("change", () => { if (wide.matches) toggleLyricsView(false); layoutLyrics(true); });

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
          const el = cellEls[b][d];
          el.classList.remove("hit");
          void el.offsetWidth;
          el.classList.add("hit");
        }
      }
    }
  }
}

function update(force) {
  if (!song) return;
  const t = audio.currentTime;
  const d = audio.duration || song.length;
  const p = clamp(t / d, 0, 1);
  $("#cur").textContent = fmt(t);
  $("#left").textContent = `-${fmt(d - t)}`;
  seek.value = Math.round(p * 1000);
  seek.setAttribute("aria-valuetext", `${fmt(t)} of ${fmt(d)}, ${sectionAt(t).name}`);
  waveEl.style.setProperty("--p", p);

  // lyrics: the sung line lights up; between lines (intro, instrumental bars) the next line waits
  const L = song.lines;
  const idx = lineIndexAt(t);
  const next = L[idx + 1];
  const gap = idx < 0 || (t > L[idx].end + 0.6 && (!next || next.t - t > 1));
  const on = gap ? -1 : idx;
  const anchor = gap ? Math.min(idx + 1, L.length - 1) : idx;
  const waiting = gap && next && !audio.paused ? idx + 1 : -1;
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
      w.style.setProperty("--wp", wp.toFixed(3));
      w.classList.toggle("sung", wp >= 1);
    }
  }

  // bar, week and section
  const n = song.weeks.length;
  const bar = clamp(Math.floor(t / song.bar), 0, n - 1);
  if (bar !== curBar || force) {
    weekEls.forEach((el, i) => { el.classList.toggle("now", i === bar && (t > 0 || !audio.paused)); el.classList.toggle("ahead", i > bar); });
    curBar = bar;
    const w = song.weeks[bar];
    const total = w.days.reduce((a, c) => a + c, 0);
    padEls.forEach((row) => row.forEach((pad, dd) => {
      const c = w.days[dd] ?? 0;
      pad.classList.toggle("on", c >= +pad.dataset.min);
      pad.style.setProperty("--o", (0.45 + 0.55 * Math.min(1, c / dmax)).toFixed(2));
    }));
    const label = `Week of ${day(w.start)} · ${total} contribution${total === 1 ? "" : "s"}`;
    $("#bar-week").textContent = `Bar ${bar + 1} of ${n}. ${label}`;
    $("#pads").setAttribute("aria-label", label);
    if (t > 0 || !audio.paused) $("#where").textContent = `${sectionAt(t).name} · ${day(w.start, { month: "short", day: "numeric", year: "numeric" })}`;
    // keep the playing week in view in the scrollable grid, unless the reader is using it
    const gs = $("#grid-scroll");
    if (!audio.paused && gs.scrollWidth > gs.clientWidth && !gs.matches(":hover, :focus-within")) {
      const el = weekEls[bar];
      const target = el.offsetLeft - gs.clientWidth / 2;
      gs.scrollTo({ left: target, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  }
  const step = Math.floor(((t / song.bar) % 1) / DAY_STEP);
  padEls.forEach((row) => row.forEach((pad, dd) => pad.classList.toggle("step", !audio.paused && dd === step)));

  const sec = sectionIndex(t);
  if (sec !== curSec || force) {
    $$("#tracklist li").forEach((li, i) => (i === sec ? li.setAttribute("aria-current", "true") : li.removeAttribute("aria-current")));
    curSec = sec;
  }
  drawWave();
  drawSleeve(t);
}

function loop() {
  if (audio.paused) return;
  const t = audio.currentTime;
  fireHits(lastT, t);
  lastT = t;
  if (!reduceMotion.matches) {
    const pk = song.peaks[Math.min(song.peaks.length - 1, Math.floor((t / (audio.duration || song.length)) * song.peaks.length))] ?? 0;
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
    title: data.title, artist: data.artist, album: `${data.stats.total} contributions`,
    artwork: [{ src: new URL("cover.png", location.href).href, sizes: "512x512", type: "image/png" }],
  });
  const handlers = {
    play: () => play(),
    pause: () => audio.pause(),
    seekto: (e) => jump(e.seekTime),
    seekbackward: (e) => jump(audio.currentTime - (e.seekOffset || 5)),
    seekforward: (e) => jump(audio.currentTime + (e.seekOffset || 5)),
    previoustrack: () => skipSection(-1),
    nexttrack: () => skipSection(1),
  };
  for (const [k, fn] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
  const pos = () => {
    if (!audio.duration || !navigator.mediaSession.setPositionState) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch {}
  };
  ["loadedmetadata", "seeked", "play", "pause", "ratechange"].forEach((ev) => audio.addEventListener(ev, pos));
}

/* ---------- misc ---------- */
fetch("contribution-song.mp3", { method: "HEAD" })
  .then((r) => { const n = +r.headers.get("content-length"); if (r.ok && n) $("#mp3-size").textContent = `${(n / 1048576).toFixed(1)} MB`; })
  .catch(() => {});

let resizeRaf = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { drawWave(); drawSleeve(); layoutLyrics(true); });
}).observe(document.body);
reduceMotion.addEventListener("change", () => { discImg = null; update(true); });

fetch("contribution-song.json", { credentials: "same-origin" })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(build)
  .catch((e) => { $("#where").textContent = "Couldn't load the song data. The MP3 download still works."; console.error(e); });
