// Visitor remix: the song's stems played through Web Audio, so anyone can mute, solo, change the tempo,
// swap the drum kit and add a filter, echo or space, then share the mix as a link or download it.
// Needs player.js (window.songPlayer) and the stems the nightly build writes to stems/.
"use strict";

(async () => {
  const P = window.songPlayer;
  if (!P) return;
  await P.ready;
  const $ = (s, el = document) => el.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const WORKLET = "remix-worklet.js?v=dev"; // the site build swaps in a hash
  const STEMS = [
    { id: "drums", name: "Drums", hint: "the daily hits" },
    { id: "bass", name: "Bass", hint: "808" },
    { id: "keys", name: "Keys", hint: "tone follows each week's language" },
    { id: "synths", name: "Synths", hint: "pads, chords and lead" },
    { id: "vocals", name: "Vocals", hint: "rap and chorus" },
    { id: "fx", name: "FX", hint: "risers, impacts, release hits" },
  ];
  const KITS = [{ id: "original", name: "Original" }, { id: "dusty", name: "Dusty" }, { id: "punchy", name: "Punchy" }];
  const DEFAULT = () => ({ tempo: 100, keep: true, kit: "original", filter: 0, echo: 0, space: 0,
    level: Object.fromEntries(STEMS.map((s) => [s.id, 100])), mute: new Set(), solo: new Set() });
  let state = DEFAULT();

  /* ---------- the mix as a link ---------- */
  function encode(st) {
    const p = ["remix"];
    if (st.tempo !== 100) p.push(`tempo=${st.tempo}`);
    if (!st.keep) p.push("pitch=free");
    if (st.kit !== "original") p.push(`kit=${st.kit}`);
    for (const k of ["filter", "echo", "space"]) if (st[k]) p.push(`${k}=${st[k]}`);
    if (st.mute.size) p.push(`mute=${[...st.mute].join(".")}`);
    if (st.solo.size) p.push(`solo=${[...st.solo].join(".")}`);
    const lv = STEMS.filter((s) => st.level[s.id] !== 100).map((s) => s.id + st.level[s.id]);
    if (lv.length) p.push(`level=${lv.join(".")}`);
    return "#" + p.join("&");
  }
  function decode(hash) {
    const q = new URLSearchParams(hash.replace(/^#/, ""));
    if (!q.has("remix")) return null;
    const st = DEFAULT();
    const num = (k, a, b, d) => { const v = Math.round(+q.get(k)); return q.has(k) && isFinite(v) ? clamp(v, a, b) : d; };
    st.tempo = num("tempo", 70, 140, 100);
    st.keep = q.get("pitch") !== "free";
    st.kit = KITS.some((k) => k.id === q.get("kit")) ? q.get("kit") : "original";
    st.filter = num("filter", -100, 100, 0);
    st.echo = num("echo", 0, 100, 0);
    st.space = num("space", 0, 100, 0);
    const ids = (k) => new Set((q.get(k) || "").split(".").filter((x) => STEMS.some((s) => s.id === x)));
    st.mute = ids("mute");
    st.solo = ids("solo");
    for (const part of (q.get("level") || "").split(".")) {
      const m = part.match(/^([a-z]+)(\d{1,3})$/);
      if (m && m[1] in st.level) st.level[m[1]] = clamp(+m[2], 0, 100);
    }
    return st;
  }
  const isDefault = (st) => encode(st) === "#remix";

  /* ---------- sound ---------- */
  const audible = (st, id) => !st.mute.has(id) && (!st.solo.size || st.solo.has(id));
  const gains = (st) => Object.fromEntries(STEMS.map((s) => [s.id, audible(st, s.id) ? (st.level[s.id] / 100) ** 2 : 0]));
  const BEAT = 60 / (P.song?.bpm || 140);

  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // a small dark room with a long-ish tail, the same every time so an export matches what you heard
  function impulse(ctx) {
    const sr = ctx.sampleRate, n = Math.round(sr * 2.6), pre = Math.round(sr * 0.018);
    const ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c), r = rng(91 + c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const a = Math.min(0.9, 0.25 + t * 0.5); // darker as it decays
        lp = lp * a + (r() * 2 - 1) * (1 - a);
        d[i] = lp * Math.exp(-t * 2.6) * 2.2;
      }
    }
    return ir;
  }
  function chain(ctx, src) {
    const node = (f) => f(ctx);
    const hp = node((c) => new BiquadFilterNode(c, { type: "highpass", frequency: 10, Q: 0.707 }));
    const lp = node((c) => new BiquadFilterNode(c, { type: "lowpass", frequency: ctx.sampleRate / 2, Q: 0.707 }));
    const dry = new GainNode(ctx), out = new GainNode(ctx);
    const echoSend = new GainNode(ctx, { gain: 0 }), delay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: BEAT * 0.75 });
    const tone = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1600, Q: 0.6 }), fb = new GainNode(ctx, { gain: 0.3 });
    const echoOut = new GainNode(ctx, { gain: 1 });
    const spaceSend = new GainNode(ctx, { gain: 0 }), conv = new ConvolverNode(ctx, { buffer: impulse(ctx), disableNormalization: true });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });
    src.connect(hp).connect(lp).connect(dry).connect(out);
    lp.connect(echoSend).connect(delay).connect(tone).connect(fb).connect(delay);
    tone.connect(echoOut).connect(out);
    lp.connect(spaceSend).connect(conv).connect(out);
    out.connect(limiter).connect(ctx.destination);
    const set = (st, instant) => {
      const at = ctx.currentTime;
      const to = (p, v) => (instant ? (p.value = v) : p.setTargetAtTime(v, at, 0.03));
      const f = st.filter / 100;
      to(lp.frequency, f < 0 ? 20000 * Math.pow(200 / 20000, -f) : ctx.sampleRate / 2);
      to(lp.Q, f < 0 ? 0.707 + 2.3 * -f : 0.707);
      to(hp.frequency, f > 0 ? 20 * Math.pow(3000 / 20, f) : 10);
      to(hp.Q, f > 0 ? 0.707 + 2.3 * f : 0.707);
      to(echoSend.gain, (st.echo / 100) * 0.55);
      to(fb.gain, 0.25 + (st.echo / 100) * 0.3);
      to(delay.delayTime, (BEAT * 0.75) / (st.tempo / 100));
      to(spaceSend.gain, (st.space / 100) * 0.7);
      to(dry.gain, 1 - (st.space / 100) * 0.15);
    };
    return { set };
  }

  /* ---------- stems: fetched once, compressed copies kept for exports ---------- */
  const info = P.song?.stems;
  const ext = (() => { try { return document.createElement("audio").canPlayType('audio/ogg; codecs="opus"') ? "ogg" : "mp3"; } catch { return "mp3"; } })();
  const raw = new Map(); // file name -> ArrayBuffer (compressed)
  const fileFor = (id, kit) => (id === "drums" && kit !== "original" ? `drums-${kit}` : id);
  async function fetchFile(name, onBytes) {
    if (raw.has(name)) return raw.get(name);
    const res = await fetch(`${info.path}${name}.${ext}?v=${encodeURIComponent(P.song.generated || "")}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    let buf;
    if (res.body && onBytes) {
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; onBytes(value.length);
      }
      const all = new Uint8Array(got);
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      buf = all.buffer;
    } else {
      buf = await res.arrayBuffer();
      onBytes?.(buf.byteLength);
    }
    raw.set(name, buf);
    return buf;
  }
  async function decodeTo(ctx, name) {
    const ab = await ctx.decodeAudioData(raw.get(name).slice(0));
    const L = new Float32Array(ab.getChannelData(0));
    const R = ab.numberOfChannels > 1 ? new Float32Array(ab.getChannelData(1)) : null;
    return { L, R };
  }
  function sendStem(node, id, d, gain, ack) {
    const transfer = [d.L.buffer];
    if (d.R) transfer.push(d.R.buffer);
    node.port.postMessage({ type: "stem", name: id, L: d.L, R: d.R, gain, ack }, transfer);
  }
  function waitAck(node, id, ms = 4000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("audio thread didn't answer")), ms);
      const prev = node.port.onmessage;
      node.port.onmessage = (e) => { if (e.data.type === "ack" && e.data.id === id) { clearTimeout(t); node.port.onmessage = prev; res(); } else prev?.(e); };
    });
  }

  /* ---------- the engine: looks like an <audio> element to player.js ---------- */
  class Engine extends EventTarget {
    constructor() {
      super();
      this.ctx = null; this.node = null; this.fx = null;
      this._paused = true; this._pos = 0; this.rate = 1; this.keep = true;
      this.tick = null; this.anchor = null; this.levels = {};
    }
    async start() {
      const ctx = (this.ctx = new AudioContext({ latencyHint: "playback" }));
      await ctx.audioWorklet.addModule(WORKLET);
      const node = (this.node = new AudioWorkletNode(ctx, "remix-player", { numberOfInputs: 0, outputChannelCount: [2] }));
      this.fx = chain(ctx, node);
      node.port.onmessage = (e) => this.onMessage(e.data);
    }
    onMessage(m) {
      if (m.type === "tick") {
        this.tick = m;
        this.levels = m.levels;
        if (this.anchor && m.time >= this.anchor.time) this.anchor = null;
      } else if (m.type === "ended") {
        this._paused = true; this._pos = this.duration;
        this.dispatchEvent(new Event("pause"));
        this.dispatchEvent(new Event("ended"));
      }
    }
    get sr() { return this.ctx.sampleRate; }
    get duration() { return P.song.length; }
    get paused() { return this._paused; }
    get playbackRate() { return this.rate; }
    get currentTime() {
      if (this._paused || !this.ctx) return this._pos;
      const ts = this.ctx.getOutputTimestamp?.();
      const heard = ts && ts.contextTime ? ts.contextTime : this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
      const ref = this.anchor || (this.tick && { pos: this.tick.pos, time: this.tick.time });
      if (!ref) return this._pos;
      return clamp((ref.pos + Math.max(0, heard - ref.time) * this.sr * this.rate) / this.sr, 0, this.duration);
    }
    set currentTime(t) {
      t = clamp(t, 0, this.duration);
      this._pos = t;
      this.node.port.postMessage({ type: "seek", pos: t * this.sr });
      this.anchor = { pos: t * this.sr, time: this.ctx.currentTime + 0.01 };
      this.dispatchEvent(new Event("seeked"));
      if (this._paused) this.dispatchEvent(new Event("timeupdate"));
    }
    async play() {
      if (!this._paused) return;
      if (this._pos >= this.duration - 0.05) this._pos = 0;
      await this.ctx.resume();
      this.node.port.postMessage({ type: "play", pos: this._pos * this.sr });
      this.anchor = { pos: this._pos * this.sr, time: this.ctx.currentTime + 0.01 };
      this._paused = false;
      this.dispatchEvent(new Event("play"));
    }
    pause() {
      if (this._paused) return;
      this._pos = this.currentTime;
      this._paused = true;
      this.node.port.postMessage({ type: "pause" });
      this.dispatchEvent(new Event("pause"));
    }
    setRate(rate, keep) {
      const t = this.currentTime;
      this.rate = rate; this.keep = keep;
      this.node.port.postMessage({ type: "rate", rate, keep });
      // re-anchor so the clock doesn't jump when the speed changes
      if (!this._paused) this.anchor = { pos: t * this.sr, time: (this.ctx.getOutputTimestamp?.().contextTime || this.ctx.currentTime) };
      this.dispatchEvent(new Event("ratechange"));
    }
    setGains(g, now) { this.node.port.postMessage({ type: "gains", gains: g, now }); }
  }

  /* ---------- UI ---------- */
  const pane = $("#remix-pane"), toggleBtn = $("#remix-toggle"), status = $("#rx-status");
  if (!info || !pane || !window.AudioWorkletNode || !window.OfflineAudioContext) {
    toggleBtn?.remove();
    return;
  }
  toggleBtn.hidden = false;
  let engine = null, loading = null, ready = false, loadedKit = null, note = "";
  const say = (msg, kind = "") => { status.textContent = msg; status.dataset.kind = kind; };

  // stem rows
  const rows = {};
  const list = $("#rx-stems");
  for (const s of STEMS) {
    const li = document.createElement("li");
    li.className = "rx-stem";
    li.dataset.id = s.id;
    li.innerHTML = `<div class="rx-name"><span class="rx-label"></span><span class="rx-hint"></span><span class="rx-meter" aria-hidden="true"><i></i></span></div>
      <input type="range" class="rx-fader" min="0" max="100" step="1" value="100">
      <button type="button" class="rx-ms rx-m" aria-pressed="false">M</button>
      <button type="button" class="rx-ms rx-s" aria-pressed="false">S</button>`;
    $(".rx-label", li).textContent = s.name;
    $(".rx-hint", li).textContent = s.hint;
    const fader = $(".rx-fader", li), m = $(".rx-m", li), so = $(".rx-s", li);
    fader.setAttribute("aria-label", `${s.name} level`);
    m.setAttribute("aria-label", `Mute ${s.name.toLowerCase()}`); m.title = `Mute ${s.name.toLowerCase()}`;
    so.setAttribute("aria-label", `Solo ${s.name.toLowerCase()}`); so.title = `Solo ${s.name.toLowerCase()}`;
    fader.addEventListener("input", () => { state.level[s.id] = +fader.value; changed(); });
    fader.addEventListener("dblclick", () => { state.level[s.id] = 100; changed(); });
    m.addEventListener("click", () => { state.mute.has(s.id) ? state.mute.delete(s.id) : state.mute.add(s.id); changed(); });
    so.addEventListener("click", (e) => {
      // shift-click (or a second solo) adds to the solo group; a plain click solos just this one
      const on = state.solo.has(s.id);
      if (e.shiftKey || e.metaKey || e.ctrlKey) on ? state.solo.delete(s.id) : state.solo.add(s.id);
      else state.solo = on && state.solo.size === 1 ? new Set() : on ? (state.solo.delete(s.id), state.solo) : new Set([...state.solo, s.id]);
      changed();
    });
    rows[s.id] = { li, fader, m, so, meter: $(".rx-meter i", li) };
    list.append(li);
  }

  // tempo
  const tempo = $("#rx-tempo"), tempoOut = $("#rx-tempo-out"), pitch = $("#rx-pitch");
  tempo.addEventListener("input", () => { state.tempo = +tempo.value; changed("rate"); });
  tempo.addEventListener("dblclick", () => { state.tempo = 100; changed("rate"); });
  $("#rx-tempo-reset").addEventListener("click", () => { state.tempo = 100; changed("rate"); });
  pitch.addEventListener("click", () => { state.keep = !state.keep; changed("rate"); });

  // kit: a radio group with arrow keys
  const kitBox = $("#rx-kit");
  const kitBtns = KITS.map((k) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "radio"); b.dataset.kit = k.id; b.textContent = k.name;
    b.addEventListener("click", () => setKit(k.id));
    b.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const i = (KITS.findIndex((x) => x.id === state.kit) + d + KITS.length) % KITS.length;
      setKit(KITS[i].id);
      kitBtns[i].focus();
    });
    kitBox.append(b);
    return b;
  });

  // knobs: drag up or right to turn, arrows and Page keys, double-click to reset
  const knobs = {};
  for (const el of document.querySelectorAll(".rx-knob")) {
    const key = el.dataset.key, min = +el.dataset.min, max = +el.dataset.max;
    knobs[key] = el;
    const set = (v) => { state[key] = clamp(Math.round(v), min, max); changed(); };
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, v: state[key] };
      el.focus({ preventScroll: true });
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const d = (e.clientX - drag.x) - (e.clientY - drag.y);
      set(drag.v + (d * (max - min)) / (e.shiftKey ? 600 : 180));
    });
    const end = () => { drag = null; };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", () => set(0));
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 2;
      const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 20, PageDown: -20 }[e.key];
      if (d !== undefined) { e.preventDefault(); e.stopPropagation(); set(state[key] + d); }
      else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); set(min); }
      else if (e.key === "End") { e.preventDefault(); e.stopPropagation(); set(max); }
      else if (e.key === "Delete" || e.key === "Backspace" || e.key === "0") { e.preventDefault(); set(0); }
    });
    el.addEventListener("wheel", (e) => { if (document.activeElement !== el) return; e.preventDefault(); set(state[key] - Math.sign(e.deltaY) * 2); }, { passive: false });
  }
  const knobText = (key, v) => key === "filter" ? (v === 0 ? "Off" : v < 0 ? `Low-pass ${-v}%` : `High-pass ${v}%`) : v === 0 ? "Off" : `${v}%`;

  function render() {
    for (const s of STEMS) {
      const r = rows[s.id];
      r.fader.value = state.level[s.id];
      r.fader.style.setProperty("--v", state.level[s.id] / 100);
      r.fader.setAttribute("aria-valuetext", `${state.level[s.id]}%`);
      r.m.setAttribute("aria-pressed", String(state.mute.has(s.id)));
      r.so.setAttribute("aria-pressed", String(state.solo.has(s.id)));
      r.li.classList.toggle("silent", !audible(state, s.id));
    }
    const bpm = Math.round((P.song.bpm * state.tempo) / 100);
    tempo.value = state.tempo;
    tempo.style.setProperty("--v", (state.tempo - 70) / 70);
    tempoOut.textContent = `${bpm} BPM · ${state.tempo}%`;
    tempo.setAttribute("aria-valuetext", `${bpm} BPM, ${state.tempo}%`);
    $("#rx-tempo-reset").hidden = state.tempo === 100;
    pitch.setAttribute("aria-checked", String(state.keep));
    kitBtns.forEach((b) => { const on = b.dataset.kit === state.kit; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
    for (const [key, el] of Object.entries(knobs)) {
      const v = state[key], min = +el.dataset.min, max = +el.dataset.max;
      el.setAttribute("aria-valuenow", v);
      el.setAttribute("aria-valuetext", knobText(key, v));
      const f = (v - min) / (max - min), mid = min < 0 ? 0.5 : 0;
      el.style.setProperty("--from", (Math.min(f, mid) * 270).toFixed(1));
      el.style.setProperty("--len", (Math.abs(f - mid) * 270).toFixed(1));
      el.style.setProperty("--rot", `${(-135 + f * 270).toFixed(1)}deg`);
      el.classList.toggle("on", v !== 0);
      $(".rx-kv", el.parentElement).textContent = knobText(key, v);
    }
    const len = P.song.length / (state.tempo / 100);
    $("#rx-length").textContent = state.tempo === 100 ? "" : `Plays for ${Math.floor(len / 60)}:${String(Math.round(len % 60)).padStart(2, "0")}`;
    $("#rx-reset").disabled = isDefault(state);
  }

  function changed(what) {
    render();
    if (!ready) return;
    engine.setGains(gains(state));
    engine.fx.set(state);
    if (what === "rate") engine.setRate(state.tempo / 100, state.keep);
  }

  async function setKit(id) {
    const prev = state.kit;
    state.kit = id;
    render();
    if (!ready || id === loadedKit) return;
    const name = fileFor("drums", id);
    try {
      if (!raw.has(name)) say(`Loading the ${id} kit…`, "busy");
      await fetchFile(name);
      const d = await decodeTo(engine.ctx, name);
      if (state.kit !== id) return; // another kit was picked meanwhile
      sendStem(engine.node, "drums", d, gains(state).drums);
      loadedKit = id;
      say("");
    } catch (e) {
      state.kit = prev; render();
      say(`That kit didn't load. ${e.message}`, "error");
    }
  }

  async function load() {
    if (ready) return;
    if (loading) return loading;
    loading = (async () => {
      pane.classList.add("loading");
      const names = STEMS.map((s) => fileFor(s.id, state.kit));
      const total = names.reduce((a, n) => a + (info.bytes?.[n]?.[ext] || 0), 0);
      let got = 0;
      const mb = (v) => (v / 1048576).toFixed(1);
      const progress = () => {
        $("#rx-bar").style.setProperty("--p", total ? Math.min(1, got / total) : 0);
        say(total ? `Loading stems · ${mb(got)} of ${mb(total)} MB` : "Loading stems…", "busy");
      };
      progress();
      try {
        engine = new Engine();
        await Promise.all([engine.start(), ...names.map((n) => fetchFile(n, (b) => { got += b; progress(); }))]);
        say("Preparing the stems…", "busy");
        const g = gains(state);
        loadedKit = state.kit;
        for (const s of STEMS) {
          const d = await decodeTo(engine.ctx, fileFor(s.id, loadedKit));
          sendStem(engine.node, s.id, d, g[s.id]);
        }
        engine.node.port.postMessage({ type: "rate", rate: state.tempo / 100, keep: state.keep });
        engine.rate = state.tempo / 100; engine.keep = state.keep;
        engine.fx.set(state, true);
        ready = true;
        pane.classList.remove("loading");
        P.use(engine);
        say(note);
        note = "";
        if (P.media === engine) document.body.classList.add("remixing");
      } catch (e) {
        console.error(e);
        pane.classList.remove("loading");
        say(`The stems couldn't be loaded, so the normal song keeps playing. ${e.message}`, "error");
        loading = null;
      }
    })();
    return loading;
  }

  // meters
  function meters() {
    if (ready && !engine.paused) {
      for (const s of STEMS) {
        const v = Math.sqrt(engine.levels[s.id] || 0);
        const lv = clamp(1 + Math.log10(v + 1e-6) / 2.4, 0, 1); // about -48 dB to 0 dB
        rows[s.id].meter.style.setProperty("--l", lv.toFixed(3));
      }
    } else if (ready) {
      for (const s of STEMS) rows[s.id].meter.style.setProperty("--l", 0);
    }
    requestAnimationFrame(meters);
  }
  requestAnimationFrame(meters);

  // open and close
  function open(on) {
    on = on ?? !document.body.classList.contains("remix-open");
    P.setPanel(on ? "remix" : null);
    toggleBtn.setAttribute("aria-pressed", String(on));
    if (on) load();
  }
  toggleBtn.addEventListener("click", () => open());
  $("#rx-close").addEventListener("click", () => { open(false); toggleBtn.focus(); });
  P.onPanel((which) => toggleBtn.setAttribute("aria-pressed", String(which === "remix")));
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== "r" || e.shiftKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    open();
  });

  $("#rx-reset").addEventListener("click", () => {
    const tempoWas = state.tempo, keepWas = state.keep;
    state = DEFAULT();
    changed(tempoWas !== 100 || !keepWas ? "rate" : undefined);
    setKit("original");
    say("Back to the original mix.");
  });

  // share
  const shareUrl = () => location.origin + location.pathname + encode(state);
  $("#rx-share").addEventListener("click", async () => {
    const url = shareUrl();
    try { history.replaceState(null, "", encode(state)); } catch {}
    try {
      await navigator.clipboard.writeText(url);
      say(isDefault(state) ? "Link copied. It opens the remix with the original mix." : "Link copied. Anyone who opens it hears this mix.");
    } catch {
      say(`Copy this link: ${url}`);
    }
  });

  // export: the same chain rendered offline, faster than real time, into a WAV
  $("#rx-export").addEventListener("click", async () => {
    const btn = $("#rx-export");
    if (!ready || btn.disabled) { open(true); return; }
    btn.disabled = true;
    const st = structuredClone({ ...state, mute: [...state.mute], solo: [...state.solo] });
    st.mute = new Set(st.mute); st.solo = new Set(st.solo);
    try {
      say("Rendering your mix…", "busy");
      const sr = engine.ctx.sampleRate, rate = st.tempo / 100;
      const tail = st.echo || st.space ? 2.5 : 0.2;
      const frames = Math.ceil((P.song.length / rate + tail) * sr);
      const off = new OfflineAudioContext(2, frames, sr);
      await off.audioWorklet.addModule(WORKLET);
      const node = new AudioWorkletNode(off, "remix-player", { numberOfInputs: 0, outputChannelCount: [2] });
      const fx = chain(off, node);
      fx.set(st, true);
      const g = gains(st);
      let n = 0;
      for (const s of STEMS) {
        const file = fileFor(s.id, st.kit);
        await fetchFile(file);
        const d = await decodeTo(off, file);
        const id = `x${++n}`;
        const ok = waitAck(node, id);
        sendStem(node, s.id, d, g[s.id], id);
        await ok;
      }
      node.port.postMessage({ type: "rate", rate, keep: st.keep });
      node.port.postMessage({ type: "gains", gains: g, now: true });
      const go = waitAck(node, "go");
      node.port.postMessage({ type: "play", pos: 0 });
      node.port.postMessage({ type: "ping", id: "go" });
      await go;
      const total = frames / sr;
      if (off.suspend) {
        for (let t = 5; t < total; t += 5) {
          off.suspend(t).then(() => { say(`Rendering your mix · ${Math.round((t / total) * 100)}%`, "busy"); off.resume(); }).catch(() => {});
        }
      }
      const buf = await off.startRendering();
      const blob = wav(buf);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nishal-contribution-song-remix${isDefault(st) ? "" : "-" + (st.tempo !== 100 ? st.tempo + "pct" : "mix")}.wav`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(`Saved ${(blob.size / 1048576).toFixed(1)} MB WAV.`);
      window.__lastRemixExport = { size: blob.size, frames, sr, name: a.download };
    } catch (e) {
      console.error(e);
      say(`The export didn't work in this browser. ${e.message}`, "error");
    } finally {
      btn.disabled = false;
    }
  });

  // 16-bit WAV with a little triangular dither (seeded, so the same mix gives the same file)
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); out.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt ");
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
    out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    const r = rng(2026);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const v = data[c][i] * 32767 + (r() - r());
        out.setInt16(o, clamp(Math.round(v), -32768, 32767), true);
        o += 2;
      }
    }
    return new Blob([out], { type: "audio/wav" });
  }

  // a shared mix opens the remix with it applied
  function fromHash() {
    const st = decode(location.hash);
    if (!st) return false;
    state = st;
    if (ready) { changed("rate"); setKit(st.kit); } else render();
    open(true);
    if (!isDefault(st)) {
      note = "This is a shared mix. Press play to hear it.";
      if (ready) say(note);
    }
    return true;
  }
  addEventListener("hashchange", fromHash);
  render();
  fromHash();

  // read-only hooks for automated tests
  Object.defineProperty(window, "__remix", { value: Object.freeze({
    get state() { return { ...state, mute: [...state.mute], solo: [...state.solo], ready, ext, link: encode(state), engine: engine && { t: engine.currentTime, paused: engine.paused, rate: engine.rate, keep: engine.keep, sr: engine.ctx?.sampleRate } }; },
    encode: (s) => encode(s), decode: (h) => { const s = decode(h); return s && { ...s, mute: [...s.mute], solo: [...s.solo] }; },
  }) });
})();
