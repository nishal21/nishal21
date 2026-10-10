// Contribution song player. No dependencies: <audio> + Web Audio AnalyserNode + canvas.
"use strict";

const $ = (s) => document.querySelector(s);
const audio = $("#audio");
const playBtn = $("#play");
const seek = $("#seek");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const dateFmt = (iso, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", opts);
// Custom properties hold light-dark() pairs; resolve them through a probe element so canvas gets a real color.
const probe = document.createElement("span");
probe.hidden = true;
document.documentElement.append(probe);
const css = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };

let song = null;
let analyser = null;
let freq = null;
let lineEls = [];
let colEls = [];
let curLine = -1;
let curBar = -1;
let curSection = -1;
let dayMax = 1;

/* ---------- theme toggle (system by default, two states) ---------- */
const meta = document.querySelector('meta[name="color-scheme"]');
const sysDark = matchMedia("(prefers-color-scheme: dark)");
const rendered = () => (meta.content === "light dark" ? (sysDark.matches ? "dark" : "light") : meta.content);
$("#theme").addEventListener("click", () => {
  const target = rendered() === "dark" ? "light" : "dark";
  const system = sysDark.matches ? "dark" : "light";
  try {
    if (target === system) localStorage.removeItem("color-scheme");
    else localStorage.setItem("color-scheme", target);
  } catch {}
  meta.content = target === system ? "light dark" : target;
  drawWave();
});
addEventListener("storage", (e) => {
  if (e.key === "color-scheme") { meta.content = e.newValue ?? "light dark"; drawWave(); }
});
sysDark.addEventListener("change", () => drawWave());

/* ---------- canvases ---------- */
function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return [c.getContext("2d"), w, h, dpr];
}

function drawWave() {
  if (!song) return;
  const [ctx, w, h] = fitCanvas($("#wave"));
  const peaks = song.peaks;
  const played = audio.duration ? audio.currentTime / audio.duration : 0;
  const bw = w / peaks.length;
  ctx.clearRect(0, 0, w, h);
  const on = css("--title"), off = css("--line");
  for (let i = 0; i < peaks.length; i++) {
    const ph = Math.max(2, peaks[i] * h * 0.9);
    ctx.fillStyle = (i + 0.5) / peaks.length <= played ? on : off;
    ctx.fillRect(i * bw, (h - ph) / 2, Math.max(1, bw - 1), ph);
  }
}

function drawViz() {
  const [ctx, w, h, dpr] = fitCanvas($("#viz"));
  ctx.clearRect(0, 0, w, h);
  const title = css("--title"), icon = css("--icon"), text = css("--text"), line = css("--line");
  const bars = 64;
  const gap = 3 * dpr;
  const bw = (w - gap * (bars - 1)) / bars;
  let levels;
  if (analyser && !audio.paused && !reduceMotion.matches) {
    analyser.getByteFrequencyData(freq);
    // log-spaced bins so bass and highs both get room
    levels = Array.from({ length: bars }, (_, i) => {
      const a = Math.floor(Math.pow(freq.length, i / bars)), b = Math.max(a + 1, Math.floor(Math.pow(freq.length, (i + 1) / bars)));
      let m = 0;
      for (let k = a; k < b && k < freq.length; k++) m = Math.max(m, freq[k]);
      return Math.pow(m / 255, 1.6);
    });
  } else if (song) {
    // static: the song's own waveform around the playhead
    const pos = audio.duration ? audio.currentTime / audio.duration : 0;
    const start = Math.floor(pos * song.peaks.length);
    levels = Array.from({ length: bars }, (_, i) => song.peaks[Math.min(song.peaks.length - 1, start + i)] * 0.8);
  } else {
    levels = new Array(bars).fill(0.05);
  }
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, text);
  grad.addColorStop(0.6, title);
  grad.addColorStop(1, icon);
  for (let i = 0; i < bars; i++) {
    const v = Math.max(0.03, levels[i]);
    const bh = v * h * 0.82;
    ctx.fillStyle = v > 0.04 ? grad : line;
    const x = i * (bw + gap);
    ctx.beginPath();
    ctx.roundRect(x, (h - bh) / 2, bw, bh, Math.min(bw / 2, 4 * dpr));
    ctx.fill();
  }
}

/* ---------- build the page from the song data ---------- */
function build(data) {
  song = data;
  const s = data.stats;
  document.documentElement.style.setProperty("--cols", data.weeks.length);
  $("#range").textContent = `${dateFmt(s.first)} to ${dateFmt(s.last)}`;
  $("#meta").textContent = `${fmt(data.length)} · ${data.bpm} BPM · ${data.key} · ${s.total} contributions`;
  $("#dur").textContent = fmt(data.length);
  $("#gen").textContent = `Last built ${new Date(data.generated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST.`;

  // sections strip
  const secList = $("#sections");
  data.sections.forEach((sec, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--bars", sec.bars);
    li.className = sec.name.toLowerCase().startsWith("verse") ? "verse" : sec.name.toLowerCase();
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = sec.name;
    b.addEventListener("click", () => jump(sec.start));
    li.append(b);
    secList.append(li);
  });

  // lyrics
  const box = $("#lyrics");
  let ol = null, last = null;
  data.lines.forEach((l, i) => {
    if (l.section !== last) {
      last = l.section;
      const h = document.createElement("h3");
      h.textContent = l.section;
      ol = document.createElement("ol");
      box.append(h, ol);
    }
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "line";
    b.innerHTML = `<span class="ts"></span><span class="words"></span>`;
    b.querySelector(".ts").textContent = fmt(l.t);
    b.querySelector(".words").textContent = l.text;
    b.addEventListener("click", () => jump(Math.max(0, l.t - 0.05)));
    li.append(b);
    ol.append(li);
    lineEls.push(b);
  });

  // sequencer grid: one column per week
  const max = Math.max(1, ...data.weeks.flatMap((w) => w.days));
  dayMax = max;
  const level = (c) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / max) * 4)));
  const seq = $("#seq");
  data.weeks.forEach((w, i) => {
    const col = document.createElement("button");
    col.type = "button";
    col.className = "col";
    const total = w.days.reduce((a, b) => a + b, 0);
    col.setAttribute("aria-label", w.start ? `Week of ${dateFmt(w.start, { month: "short", day: "numeric" })}: ${total} contributions. Play from here.` : `Week ${i + 1}`);
    for (let d = 0; d < 7; d++) {
      const c = document.createElement("span");
      c.className = "cell";
      c.dataset.l = level(w.days[d] ?? 0);
      col.append(c);
    }
    col.addEventListener("click", () => jump(i * data.bar));
    seq.append(col);
    colEls.push(col);
  });

  // pads for the current bar
  const pads = $("#pads");
  pads.append(Object.assign(document.createElement("span"), { textContent: "" }));
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => pads.append(Object.assign(document.createElement("span"), { className: "day", textContent: d })));
  const colors = { kick: "--title", snare: "--text", hat: "--icon", clap: "--warn" };
  ["kick", "snare", "hat", "clap"].forEach((name) => {
    pads.append(Object.assign(document.createElement("span"), { className: "lab", textContent: name[0].toUpperCase() + name.slice(1) }));
    for (let d = 0; d < 7; d++) {
      const p = document.createElement("span");
      p.className = "pad";
      p.dataset.rule = name;
      p.dataset.day = d;
      p.style.setProperty("--c", `var(${colors[name]})`);
      pads.append(p);
    }
  });
  pads.setAttribute("role", "img");
  $("#rules").textContent = "Each day plays a kick at 1+ contributions, a hat at 3+, a snare at 6+ and a clap at 10+.";

  // stats
  const month = new Date(s.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const items = [
    ["Contributions", s.total, `${dateFmt(s.first)} to ${dateFmt(s.last)}`],
    ["Active days", s.active, `of ${s.days}`],
    ["Best day", s.best_n, dateFmt(s.best)],
    ["Busiest month", s.month_n, month],
    ["Longest streak", `${s.streak} days`, `${dateFmt(s.streak_start, { month: "short", day: "numeric" })} to ${dateFmt(s.streak_end)}`],
  ];
  if (s.recent?.length) items.push(["Recently active", s.recent[0], s.recent.slice(1).join(", ")]);
  const dl = $("#stats");
  for (const [k, v, small] of items) {
    const div = document.createElement("div");
    div.innerHTML = "<dt></dt><dd><span></span><small></small></dd>";
    div.querySelector("dt").textContent = k;
    div.querySelector("dd span").textContent = v;
    div.querySelector("small").textContent = small;
    dl.append(div);
  }

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: data.title, artist: data.artist, album: `${s.total} contributions` });
    navigator.mediaSession.setActionHandler("play", () => play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("seekto", (e) => jump(e.seekTime));
    navigator.mediaSession.setActionHandler("seekbackward", () => jump(audio.currentTime - 5));
    navigator.mediaSession.setActionHandler("seekforward", () => jump(audio.currentTime + 5));
  }
  playBtn.disabled = false;
  seek.disabled = false;
  update();
}

/* ---------- playback ---------- */
function ensureAnalyser() {
  if (analyser || !window.AudioContext) return;
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    freq = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser).connect(ctx.destination);
    audio._ctx = ctx;
  } catch (e) {
    analyser = null; // visualizer falls back to the static waveform
  }
}

async function play() {
  ensureAnalyser();
  if (audio._ctx?.state === "suspended") await audio._ctx.resume();
  try { await audio.play(); } catch (e) { console.warn("Playback was blocked:", e.message); }
}

function jump(t) {
  const d = audio.duration || song?.length || 0;
  audio.currentTime = Math.min(Math.max(0, t), Math.max(0, d - 0.05));
  update();
}

playBtn.addEventListener("click", () => (audio.paused ? play() : audio.pause()));
audio.addEventListener("play", () => { document.body.classList.add("playing"); playBtn.setAttribute("aria-label", "Pause"); loop(); });
audio.addEventListener("pause", () => { document.body.classList.remove("playing"); playBtn.setAttribute("aria-label", "Play"); update(); });
audio.addEventListener("ended", () => { audio.currentTime = 0; update(); });
audio.addEventListener("timeupdate", () => { if (audio.paused) update(); });
audio.addEventListener("loadedmetadata", () => { $("#dur").textContent = fmt(audio.duration); update(); });
seek.addEventListener("input", () => jump((seek.value / 100) * (audio.duration || song.length)));

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [contenteditable]") && e.key !== " ") return;
  if (e.target.closest("button, a") && (e.key === " " || e.key === "Enter")) return; // let buttons and links act normally
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === " " || e.key === "k") { e.preventDefault(); audio.paused ? play() : audio.pause(); }
  else if (e.key === "ArrowLeft" && e.target !== seek) { e.preventDefault(); jump(audio.currentTime - 5); }
  else if (e.key === "ArrowRight" && e.target !== seek) { e.preventDefault(); jump(audio.currentTime + 5); }
  else if (e.key === "Home" && e.target !== seek) { e.preventDefault(); jump(0); }
});

function update() {
  if (!song) return;
  const t = audio.currentTime;
  const d = audio.duration || song.length;
  $("#cur").textContent = fmt(t);
  seek.value = d ? (t / d) * 100 : 0;
  seek.setAttribute("aria-valuetext", `${fmt(t)} of ${fmt(d)}`);

  // lyrics: current line plus a rough word sweep across the line's sung duration
  let idx = -1;
  for (let i = 0; i < song.lines.length; i++) if (t >= song.lines[i].t - 0.05) idx = i;
  if (idx !== curLine) {
    lineEls.forEach((el, i) => { el.classList.toggle("done", i < idx); if (i === idx) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current"); });
    curLine = idx;
    if (idx >= 0) {
      const box = $("#lyrics"), el = lineEls[idx];
      const top = el.offsetTop - box.offsetTop - box.clientHeight / 3;
      box.scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  }
  if (idx >= 0) {
    const l = song.lines[idx];
    const p = Math.min(1, Math.max(0, (t - l.t) / Math.max(0.1, l.end - l.t)));
    lineEls[idx].style.setProperty("--p", `${(p * 100).toFixed(1)}%`);
  }

  // bar and section
  const bar = Math.min(song.weeks.length - 1, Math.floor(t / song.bar));
  if (bar !== curBar) {
    colEls.forEach((c, i) => { c.classList.toggle("on", i === bar); c.classList.toggle("past", i < bar); });
    curBar = bar;
    const w = song.weeks[bar];
    document.querySelectorAll(".pad").forEach((p) => {
      const c = w.days[p.dataset.day] ?? 0;
      const rule = song.rules.find((r) => r.name === p.dataset.rule);
      p.classList.toggle("hit", c >= rule.min);
      p.style.setProperty("--o", (0.45 + 0.55 * Math.min(1, c / dayMax)).toFixed(2));
    });
    const total = w.days.reduce((a, b) => a + b, 0);
    $("#pads").setAttribute("aria-label", w.start ? `Week of ${dateFmt(w.start)}: ${total} contributions` : "Empty week");
    $("#now").textContent = w.start ? `Bar ${bar + 1} · week of ${dateFmt(w.start, { month: "short", day: "numeric", year: "numeric" })} · ${total} contributions` : "";
  }
  const day = Math.min(6, Math.floor(((t % song.bar) / song.bar) * 8));
  document.querySelectorAll(".pad").forEach((p) => p.classList.toggle("step", !audio.paused && +p.dataset.day === day));
  let sec = 0;
  song.sections.forEach((s, i) => { if (t >= s.start) sec = i; });
  if (sec !== curSection) {
    document.querySelectorAll("#sections li").forEach((li, i) => (i === sec ? li.setAttribute("aria-current", "true") : li.removeAttribute("aria-current")));
    curSection = sec;
  }
  drawWave();
  drawViz();
}

function loop() {
  update();
  if (!audio.paused) requestAnimationFrame(loop);
}

new ResizeObserver(() => { drawWave(); drawViz(); }).observe(document.body);

fetch("contribution-song.json", { credentials: "same-origin" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(build)
  .catch((e) => { $("#meta").textContent = "Couldn't load the song data. The MP3 download still works."; console.error(e); });
drawViz();
