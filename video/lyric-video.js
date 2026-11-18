/* The songs' lyric videos (visitor song and contribution song), drawn live over the song (the same look as scripts/visitor_video.py renders to MP4):
   letterbox, flat colour, light grain, a slow drift, each word rising in as it is sung, a card naming who wrote the
   line, Open Doodles (each used once) and a credits roll. It follows the page's <video> element, which plays the audio,
   so play, pause, seek, speed, fullscreen and the embed all work as for any video. Timings come from visitor-video.json. */
(() => {
  const W = 1920, H = 1080, BAR = 132, TOP = BAR, BOTTOM = H - BAR, TEXT_X = 156, TEXT_W = 1000;
  const ART = [1250, 236, 1780, 844];
  const ease = (x) => { x = Math.min(1, Math.max(0, x)); return 1 - (1 - x) ** 3; };
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    const faces = [new FontFace("LVDisplay", "url(../player/fonts/bricolage-grotesque.woff2)", { weight: "200 800" }),
                   new FontFace("LVMono", "url(../player/fonts/jetbrains-mono.woff2)", { weight: "100 800" }),
                   new FontFace("LVRap", "url(../player/fonts/anton.woff2)", { weight: "400" })];
    fontsReady = Promise.all(faces.map((f) => f.load().then((x) => document.fonts.add(x)).catch(() => null)));
    return fontsReady;
  }
  const F = (size, w = 800) => `${w} ${size}px LVDisplay, system-ui, sans-serif`;
  const M = (size, w = 500) => `${w} ${size}px LVMono, ui-monospace, monospace`;
  const R = (size) => `400 ${size}px LVRap, Impact, "Arial Narrow", sans-serif`;  // Anton: heavy, condensed

  // Two moods for the contribution song, both timed from the take's own tempo in the plan (bpm, beat0), so a new
  // take drops in without touching this file. Original ("rap"): a hard beat grid, a punch-in on every bar, a nudge
  // on 2 and 4, the section name huge and outlined behind the words, pulse bars, a flash on each new section and
  // heavy condensed capitals lit word by word. Acoustic ("calm"): warm and dim, a soft light drifting and breathing
  // once a bar, slow fades, the drawings.
  const CALM = {
    Intro: { bg: [34, 25, 21], ink: [244, 233, 214], acc: [236, 170, 96] },
    Verse: { bg: [38, 27, 22], ink: [244, 233, 214], acc: [236, 170, 96] },
    Chorus: { bg: [52, 34, 24], ink: [250, 238, 218], acc: [244, 186, 110] },
    Breakdown: { bg: [30, 26, 28], ink: [236, 226, 214], acc: [214, 160, 120] },
    Outro: { bg: [28, 22, 20], ink: [244, 233, 214], acc: [236, 170, 96] },
  };
  const calmLook = (name) => CALM[name] || CALM[String(name || "").replace(/\s*\d+$/, "")] || CALM.Verse;

  // The plan's looks are paper ones (cream, lime chorus, dark outro), as in the MP4. On the dark page they're turned
  // into night versions of the same colours: the light backgrounds go deep and dark and lend their colour to the words.
  // They keep a clear hue (wine for the cream verses, olive for the lime chorus) because the ambient light copies the
  // picture's edges, and a near-black picture would give it nothing to show.
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const mix = (a, k) => a.map((c) => Math.round(18 + (c - 18) * k));
  function nightLook(L) {
    if (lum(L.bg) < 0.5) return L;
    const paper = Math.max(...L.bg) - Math.min(...L.bg) < 40;  // the cream page, not a coloured one
    return { bg: paper ? mix(L.acc, 0.16) : mix(L.bg, 0.2), ink: L.bg, acc: L.acc };
  }

  function attach({ stage, video, planUrl, reduce, night, onFrame }) {
    const canvas = document.createElement("canvas");
    canvas.className = "lyric-canvas";
    canvas.setAttribute("aria-hidden", "true");
    video.after(canvas);
    const ctx = canvas.getContext("2d");
    let plan = null, dead = false, raf = 0, scale = 1;
    let mood = null, beat = 60 / 140, beat0 = 0;
    const still = () => reduce?.matches;
    const art = {};        // slot|look -> {img, w, h} or null while loading
    const wrapCache = new Map();

    // grain: a few noise tiles, one per frame
    const grain = [0, 1, 2, 3].map(() => {
      const c = document.createElement("canvas"); c.width = c.height = 192;
      const g = c.getContext("2d"), d = g.createImageData(192, 192);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0); return c;
    });

    function size() {
      const r = stage.getBoundingClientRect();
      const fit = Math.min(r.width, r.height * 16 / 9) || 960;
      const px = Math.min(W, Math.round(fit * Math.min(2, devicePixelRatio || 1)));
      if (canvas.width !== px) { canvas.width = px; canvas.height = Math.round(px * 9 / 16); wrapCache.clear(); }
      scale = canvas.width / W;
    }
    const ro = "ResizeObserver" in window ? new ResizeObserver(() => { size(); draw(); }) : null;
    ro?.observe(stage);

    function drawing(slot, look) {
      const url = plan?.art?.[slot];
      if (!url) return null;
      const key = slot + "|" + look.ink + look.acc;
      if (key in art) return art[key];
      art[key] = null;
      fetch(url).then((r) => r.text()).then((svg) => {
        svg = svg.replace(/fill="#000(000)?"/gi, `fill="${hex(look.ink)}"`).replace(/fill="#FF5678"/gi, `fill="${hex(look.acc)}"`);
        const img = new Image();
        img.onload = () => {
          // crop to the drawing and fit it in the drawing column
          const bw = ART[2] - ART[0], bh = ART[3] - ART[1];
          const c = document.createElement("canvas"); c.width = 1024; c.height = Math.round(1024 * (img.height || 768) / (img.width || 1024));
          const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
          const a = g.getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
          for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (a[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          if (x1 <= x0) return;
          const k = Math.min(bw / (x1 - x0), bh / (y1 - y0));
          const out = document.createElement("canvas"); out.width = Math.round((x1 - x0) * k); out.height = Math.round((y1 - y0) * k);
          out.getContext("2d").drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
          art[key] = { img: out, w: out.width, h: out.height };
          URL.revokeObjectURL(img.src);
          draw();
        };
        img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      }).catch(() => {});
      return null;
    }

    function putDrawing(slot, look, t0, t1, t, drift) {
      const d = drawing(slot, look);
      if (!d || t < t0 || t > t1) return;
      const p = still() ? 1 : ease((t - t0) / 0.9);
      const out = 1 - ease((t - (t1 - 0.45)) / 0.45);
      const fade = still() ? Math.min(1, (t - t0) / 0.4) : 1;
      let x = ART[0] + (ART[2] - ART[0] - d.w) / 2 + drift[0] * 3;
      let y = ART[1] + (ART[3] - ART[1] - d.h) / 2 + drift[1] * 3 + (still() ? 0 : 4 * Math.sin(t * 1.3) + 20 * (1 - p));
      ctx.save();
      ctx.globalAlpha = Math.max(0, out) * fade;
      ctx.beginPath(); ctx.rect(x, y, Math.max(1, d.w * p), d.h); ctx.clip();
      ctx.drawImage(d.img, x, y);
      ctx.restore();
    }

    function layout(text, rap = false) {
      const key = (rap ? "R|" : "") + text;
      if (wrapCache.has(key)) return wrapCache.get(key);
      const words = (rap ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);
      let res = null;
      for (const s of rap ? [168, 150, 134, 118, 104, 92, 80, 70] : [112, 100, 88, 76, 66, 58, 50, 44]) {
        ctx.font = rap ? R(s) : F(s);
        const rows = wrap(words, rap ? TEXT_W + 60 : TEXT_W);
        res = { size: s, rows };
        if (rows.length <= 3) break;
      }
      wrapCache.set(key, res);
      return res;
    }
    function wrap(words, width) {
      const pieces = [];
      for (let w of words) {
        while (ctx.measureText(w).width > width) {
          let k = w.length; while (k > 1 && ctx.measureText(w.slice(0, k) + "-").width > width) k--;
          pieces.push(w.slice(0, k) + "-"); w = w.slice(k);
        }
        pieces.push(w);
      }
      const sp = ctx.measureText(" ").width, rows = []; let row = [], x = 0;
      for (const w of pieces) {
        const lw = ctx.measureText(w).width;
        if (row.length && x + sp + lw > width) { rows.push(row); row = []; x = 0; }
        x += (row.length ? sp : 0) + lw; row.push(w);
      }
      if (row.length) rows.push(row);
      return rows;
    }
    const fitFont = (text, s, min, fn, width) => { ctx.font = fn(s); while (s > min && ctx.measureText(text).width > width) { s -= 4; ctx.font = fn(s); } return s; };

    function current(t) { let r = null, i = -1; plan.lines.forEach((x, k) => { if (x.t - 0.5 <= t) { r = x; i = k; } }); return [r, i]; }
    function lookAt(t) {
      if (mood === "calm") {
        if (t < plan.first - 0.5) return calmLook("Intro");
        if (t >= plan.roll_start) return calmLook("Outro");
        return calmLook(current(t)[0]?.section);
      }
      if (t < plan.first - 0.5) return plan.looks.Intro;
      if (t >= plan.roll_start) return plan.looks.Credits;
      const [r] = current(t);
      return plan.looks[r?.section] || plan.looks.Verse;
    }
    // where t sits on the take's beat grid: beat number and seconds since it
    function onBeat(t) { const x = (t - beat0) / beat, n = Math.floor(x); return { n, dt: (x - n) * beat }; }

    function title(t, L, drift) {
      const x = TEXT_X + drift[0], y = 300 + drift[1];
      ctx.textBaseline = "top";
      ["visitor", "song"].forEach((w, i) => {
        const p = still() ? 1 : ease((t - 0.3 - i * 0.35) / 0.9);
        ctx.font = F(220); ctx.fillStyle = rgb(L.ink, still() ? Math.min(1, t / 0.6) : p);
        ctx.fillText(w, x, y + i * 205 + 50 * (1 - p) + 18);
      });
      const n = plan.lines.length, v = plan.people;
      const sub = `${n} lines · ${v} visitor${v === 1 ? "" : "s"} · grows every night`;
      const p = ease((t - 1.4) / 0.8);
      ctx.font = M(34); ctx.fillStyle = rgb(L.ink, p); ctx.fillText(sub, x + 8, y + 470);
      ctx.fillStyle = rgb(L.acc); ctx.fillRect(x + 8, y + 445, ctx.measureText(sub).width * p, 6);
      putDrawing("title", L, 0.6, plan.first - 0.5, t, drift);
    }

    function lyric(t, L, drift) {
      const [r, idx] = current(t);
      if (!r) return;
      const start = r.t - 0.5, stop = Math.min(r.next - 0.5, plan.roll_start);
      const rap = mood === "rap", calm = mood === "calm";
      const { size: fs, rows } = rap ? layout(r.text, true) : r.rows ? { size: r.size, rows: r.rows } : layout(r.text);
      const lh = Math.round(fs * (rap ? 1.0 : 1.08)), block = lh * rows.length;
      const out = calm ? 0.8 : rap ? 0.18 : 0.35;
      const leave = ease((t - (stop - out)) / out);
      const y0 = (TOP + BOTTOM) / 2 - block / 2 - 40 + drift[1] - (still() ? 0 : 30 * leave);
      const x0 = TEXT_X + drift[0];
      const ghost = L.bg.map((c, i) => Math.round(c * 0.78 + L.ink[i] * 0.22));
      const times = r.words.map((w) => w[1]);
      ctx.font = rap ? R(fs) : F(fs); ctx.textBaseline = "top";
      const sp = ctx.measureText(" ").width;
      let k = 0, sung = null;
      const pre = still() ? 1 : ease((t - start) / (calm ? 1.0 : rap ? 0.12 : 0.5));
      const litFor = calm ? 0.6 : rap ? 0.07 : 0.28, rise = calm ? 6 : rap ? 0 : 18;
      rows.forEach((row, ri) => {
        let x = x0;
        for (const w of row) {
          const wt = times[Math.min(k, times.length - 1)];
          if (!w.endsWith("-")) k++;
          const adv = ctx.measureText(w).width, y = y0 + ri * lh;
          const lit = ease((t - wt) / litFor), a = 1 - leave;
          const nxt = k < times.length ? times[k] : wt + 0.6;
          const now = wt <= t && t < nxt;
          if (lit < 1) { ctx.fillStyle = rgb(ghost, pre * a); ctx.fillText(w, x, y); }
          if (lit > 0 && rap && now && !still()) {
            // the word being rapped: accent colour, a quick pop that settles
            const pop = 1 + 0.1 * Math.exp(-(t - wt) / 0.09);
            ctx.save(); ctx.translate(x, y + fs * 0.5); ctx.scale(pop, pop);
            ctx.fillStyle = rgb(L.acc, a); ctx.fillText(w, 0, -fs * 0.5); ctx.restore();
          } else if (lit > 0) {
            ctx.fillStyle = rgb(rap && now ? L.acc : L.ink, lit * a); ctx.fillText(w, x, y + (still() ? 0 : rise * (1 - lit)));
          }
          if (now) sung = [x, y, adv];
          x += adv + sp;
        }
      });
      if (sung && leave < 0.5 && !rap) { ctx.fillStyle = rgb(L.acc, calm ? 0.7 : 1); ctx.fillRect(sung[0], sung[1] + fs * 1.02, sung[2], calm ? 4 : 7); }
      // who wrote it
      const p = ease((t - start - 0.3) / 0.6) * (1 - leave);
      if (p > 0.02 && r.who.startsWith("@")) {  // only visitor lines get a card
        const visitor = true, cy = y0 + block + 34, who = r.who.slice(0, 40);
        ctx.font = M(24); const lw = ctx.measureText(visitor ? "lyric by" : "words by").width;
        ctx.font = F(38, 700); const nw = ctx.measureText(who).width;
        const cw = Math.max(lw, nw) + 48, cx = x0 + 4 - (still() ? 0 : 16 * (1 - p));
        const fg = visitor ? [17, 17, 17] : L.ink;
        ctx.globalAlpha = p;
        if (visitor) { ctx.fillStyle = rgb(L.acc); ctx.fillRect(cx, cy, cw, 104); }
        else { ctx.strokeStyle = rgb(L.ink); ctx.lineWidth = 3; ctx.strokeRect(cx + 1.5, cy + 1.5, cw - 3, 101); }
        ctx.fillStyle = rgb(fg);
        ctx.font = M(24); ctx.fillText(visitor ? "lyric by" : "words by", cx + 24, cy + 16);
        ctx.font = F(38, 700); ctx.fillText(who, cx + 24, cy + 50);
        ctx.globalAlpha = 1;
      }
      ctx.font = M(24); ctx.fillStyle = rgb(L.ink, 0.7);
      ctx.fillText(`${r.section.toLowerCase()} · ${String(idx + 1).padStart(2, "0")} / ${String(plan.lines.length).padStart(2, "0")}`, TEXT_X, TOP + 40);
      if (!rap) putDrawing("line" + idx, L, start + 0.15, stop, t, drift);
    }

    /* ----- the moods' backgrounds ----- */
    // rap: the section name, huge and outlined, sliding slowly behind the words
    function rapBack(t, L) {
      const r = current(t)[0], name = (t >= plan.roll_start ? "nishal21" : (r?.section || "Intro").replace(/\s*\d+$/, "")).toUpperCase();
      ctx.save();
      ctx.font = R(520); ctx.textBaseline = "alphabetic";
      const w = ctx.measureText(name).width;
      const x = W - w * 0.86 - (still() ? 0 : (t * 26) % 260);
      ctx.lineWidth = 3; ctx.strokeStyle = rgb(L.acc, 0.2); ctx.strokeText(name, x, BOTTOM - 70);
      ctx.restore();
    }
    // rap: pulse bars along the bottom, every one hit on the beat and falling off before the next
    function rapBars(t, L) {
      const { n, dt } = onBeat(t), N = 32, bw = (W - 2 * TEXT_X) / N;
      const fall = still() ? 0.5 : Math.exp(-dt / (beat * 0.45));
      for (let i = 0; i < N; i++) {
        const seed = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453, rnd = seed - Math.floor(seed);
        const h = 10 + (n % 4 === 0 ? 70 : 44) * fall * (0.35 + 0.65 * rnd);
        ctx.fillStyle = rgb(L.acc, 0.34); ctx.fillRect(TEXT_X + i * bw + 3, BOTTOM - 26 - h, bw - 6, h);
      }
    }
    // rap: a flash on the first beat of a new section
    function rapFlash(t, L) {
      let prev = null;
      for (const r of plan.lines) {
        if (prev !== null && r.section !== prev) {
          const dt = t - r.t;
          if (dt >= -0.02 && dt < 0.14) { ctx.fillStyle = rgb(L.acc, 0.55 * (1 - Math.max(0, dt) / 0.14)); ctx.fillRect(0, TOP, W, BOTTOM - TOP); }
        }
        prev = r.section;
      }
      const dt = t - plan.roll_start;
      if (dt >= 0 && dt < 0.14) { ctx.fillStyle = rgb(L.acc, 0.5 * (1 - dt / 0.14)); ctx.fillRect(0, TOP, W, BOTTOM - TOP); }
    }
    // calm: a soft light drifting across the picture, breathing once a bar
    function calmLight(t, L) {
      const { n, dt } = onBeat(t), barPos = ((((n % 4) + 4) % 4) * beat + dt) / (4 * beat);
      const breath = still() ? 0.5 : 0.5 - 0.5 * Math.cos(2 * Math.PI * barPos);
      const cx = W * 0.62 + (still() ? 0 : 320 * Math.sin(t * 0.06)), cy = H * 0.46 + (still() ? 0 : 110 * Math.cos(t * 0.045));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 760);
      g.addColorStop(0, rgb(L.acc, 0.13 + 0.05 * breath)); g.addColorStop(0.55, rgb(L.acc, 0.04)); g.addColorStop(1, rgb(L.acc, 0));
      ctx.fillStyle = g; ctx.fillRect(0, TOP, W, BOTTOM - TOP);
    }
    // rap: the camera punches in on each bar's downbeat and nudges on 2 and 4
    function rapCamera(t) {
      if (still() || t < plan.first - 0.5 || t >= plan.roll_start) return [1, 0, 0];
      const { n, dt } = onBeat(t), b = ((n % 4) + 4) % 4;
      const z = b === 0 ? 1 + 0.04 * Math.exp(-dt / 0.12) : 1 + 0.008 * Math.exp(-dt / 0.1);
      const kick = b === 1 || b === 3 ? Math.exp(-dt / 0.06) : 0;
      return [z, (n % 8 < 4 ? 1 : -1) * 7 * kick, -4 * kick];
    }

    function credits(t, L, drift) {
      let y = BOTTOM - (t - plan.roll_start) * plan.speed + 20;
      const x = TEXT_X + 40;
      ctx.textBaseline = "top";
      for (const [row, h] of plan.credits) {
        const i = row.indexOf(":"), kind = row.slice(0, i), text = row.slice(i + 1);
        if (y > TOP - 200 && y < BOTTOM + 10) {
          if (kind === "label") { ctx.font = M(26); ctx.fillStyle = rgb(L.acc); ctx.fillText(text, x, y + 30); }
          else if (kind === "big") { fitFont(text, 76, 40, (s) => F(s), 1000); ctx.fillStyle = rgb(L.ink); ctx.fillText(text, x, y + 20); }
          else if (kind === "person") {
            const [who, line] = [text.slice(0, text.indexOf("|")), text.slice(text.indexOf("|") + 1)];
            fitFont(who.slice(0, 40), 52, 30, (s) => F(s, 700), 1000); ctx.fillStyle = rgb(L.ink); ctx.fillText(who.slice(0, 40), x, y + 4);
            ctx.font = M(28, 400); ctx.fillStyle = rgb(L.ink, 0.62);
            ctx.fillText(ctx.measureText(line).width < 980 ? line : line.slice(0, 60) + "…", x + 2, y + 70);
          }
        }
        y += h;
      }
      if (t > plan.end_card - 0.5) {
        const p = ease((t - plan.end_card + 0.5) / 0.8);
        // same words as END_CARD in scripts/visitor_video.py
        const [big, small] = /contribution/.test(plan.credits?.[0]?.[0] || "")
          ? ["thanks for listening", "github.com/nishal21 · sung again every night"]
          : ["add your line", "github.com/nishal21 · leave a note on the profile"];
        ctx.font = F(150); ctx.fillStyle = rgb(L.ink, p); ctx.fillText(big, TEXT_X, 380 + (still() ? 0 : 30 * (1 - p)) + 12);
        ctx.font = M(32); ctx.fillStyle = rgb(L.acc, p); ctx.fillText(small, TEXT_X + 6, 590);
      }
      putDrawing("credits", L, plan.roll_start + 0.6, plan.total, t, drift);
    }

    function wipe(t) {
      const changes = []; let prev = "Intro";
      for (const r of plan.lines) {
        if (r.section !== prev && JSON.stringify(plan.looks[r.section]) !== JSON.stringify(plan.looks[prev])) changes.push([r.t - 0.5, plan.looks[r.section] || plan.looks.Verse]);
        prev = r.section;
      }
      changes.push([plan.roll_start, plan.looks.Credits]);
      for (const [at, L] of changes) {
        const dt = t - (at - 0.35);
        if (dt >= 0 && dt < 0.6) {
          const x0 = dt > 0.35 ? W * ease(dt / 0.6) : 0, x1 = W * Math.min(1, dt / 0.35);
          ctx.fillStyle = rgb(L.acc); ctx.fillRect(x0, TOP, x1 - x0, BOTTOM - TOP);
        }
      }
    }

    let frameNo = 0;
    function draw() {
      if (dead || !plan) return;
      const t = video.currentTime || 0;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const slow = mood === "calm" ? 0.6 : 1;
      const drift = still() ? [0, 0] : [6 * Math.sin(t * 0.21 * slow), 4 * Math.cos(t * 0.17 * slow)];
      // the rap look is always the dark one (tinted, so the ambient light still has a colour to pick up)
      const L0 = lookAt(t), L = mood === "calm" ? L0 : night?.() || mood === "rap" ? nightLook(L0) : L0;
      ctx.fillStyle = rgb(L.bg); ctx.fillRect(0, 0, W, H);
      if (mood === "rap") {
        const [z, dx, dy] = rapCamera(t);
        ctx.setTransform(scale * z, 0, 0, scale * z, scale * ((1 - z) * W / 2 + dx), scale * ((1 - z) * H / 2 + dy));
        rapBack(t, L);
        if (t >= plan.first - 0.5 && t < plan.roll_start) rapBars(t, L);
      } else if (mood === "calm") calmLight(t, L);
      if (t < plan.first - 0.5) title(t, L, drift);
      else if (t >= plan.roll_start) credits(t, L, drift);
      else lyric(t, L, drift);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (!still() && mood === "rap") rapFlash(t, L);
      else if (!still() && !mood) wipe(t);
      // grain, then the letterbox
      ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = "overlay";
      const g = grain[still() ? 0 : frameNo++ % 4];
      ctx.fillStyle = ctx.createPattern(g, "repeat"); ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, TOP); ctx.fillRect(0, BOTTOM, W, H - BOTTOM);
      const k = Math.min(1, t / 0.8, Math.max(0, (plan.total - t) / 1.2));
      if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, k)})`; ctx.fillRect(0, 0, W, H); }
      onFrame?.(canvas);
    }
    function loop() { cancelAnimationFrame(raf); if (dead) return; draw(); if (!video.paused) raf = requestAnimationFrame(loop); }
    const kick = () => draw();
    for (const e of ["seeked", "timeupdate", "loadedmetadata"]) video.addEventListener(e, kick);
    video.addEventListener("play", loop);

    size();
    Promise.all([fetch(planUrl).then((r) => r.json()), loadFonts()]).then(([p]) => {
      if (dead) return;
      plan = p;
      mood = p.mood || (/contribution-acoustic-video/.test(planUrl) ? "calm" : /contribution-video/.test(planUrl) ? "rap" : null);
      const bpm = +p.bpm || (mood === "calm" ? 76 : 140);
      beat = 60 / bpm; beat0 = +p.beat0 || 0;
      stage.classList.add("lyric-on"); wrapCache.clear(); draw(); loop();
    }).catch(() => canvas.remove());
    return {
      canvas,
      redraw() { if (plan) draw(); },
      destroy() {
        dead = true; cancelAnimationFrame(raf); ro?.disconnect(); canvas.remove(); stage.classList.remove("lyric-on");
        for (const e of ["seeked", "timeupdate", "loadedmetadata"]) video.removeEventListener(e, kick);
        video.removeEventListener("play", loop);
      },
    };
  }
  window.LyricVideo = { attach };
})();
