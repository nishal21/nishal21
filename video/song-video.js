/* The contribution song's lyric video (Original and Acoustic), drawn live over the song by the Videos page.
   The year's real contribution graph drifts past out of focus behind the words, the camera moving through the year
   as the song plays; the line being sung is set huge, each row stretched across, and lights up word by word, with
   the line before and after small, dim and blurred. Original (rap) is snappy and hits on the beat; Acoustic (calm)
   moves slowly with soft fades. Dark and light versions follow the page's theme. Timings come from the plan JSON. */
(() => {
  const W = 1920, H = 1080;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => 1 - (1 - clamp01(x)) ** 3;
  const easeIO = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const lerpC = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    const faces = [
      new FontFace("LVInter", "url(../player/fonts/inter-tight.woff2)", { weight: "300 800" }),
      new FontFace("LVArchivo", "url(../player/fonts/archivo.woff2)", { weight: "100 900", stretch: "62% 125%" }),
      new FontFace("LVDisplay", "url(../player/fonts/bricolage-grotesque.woff2)", { weight: "200 800" }),
      new FontFace("LVMono", "url(../player/fonts/jetbrains-mono.woff2)", { weight: "100 800" }),
    ];
    fontsReady = Promise.all(faces.map((f) => f.load().then((x) => document.fonts.add(x)).catch(() => null)));
    return fontsReady;
  }

  function attach({ stage, video, planUrl, reduce, night, onFrame }) {
    const canvas = document.createElement("canvas");
    canvas.className = "lyric-canvas";
    canvas.setAttribute("aria-hidden", "true");
    video.after(canvas);
    const ctx = canvas.getContext("2d");
    let plan = null, dead = false, raf = 0, scale = 1, mood = "rap", beat = 60 / 140, beat0 = 0, weeks = null;
    const still = () => reduce?.matches;
    const cache = new Map();
    const grain = [0, 1, 2].map(() => {
      const c = document.createElement("canvas"); c.width = c.height = 160;
      const g = c.getContext("2d"), d = g.createImageData(160, 160);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0); return c;
    });

    function size() {
      const r = stage.getBoundingClientRect();
      const fit = Math.min(r.width, r.height * 16 / 9) || 960;
      const px = Math.min(W, Math.round(fit * Math.min(2, devicePixelRatio || 1)));
      if (canvas.width !== px) { canvas.width = px; canvas.height = Math.round(px * 9 / 16); cache.clear(); }
      scale = canvas.width / W;
    }
    const ro = "ResizeObserver" in window ? new ResizeObserver(() => { size(); draw(); }) : null;
    ro?.observe(stage);

    /* ---------- the shared lyric engine ---------- */
    const lineAt = (t, lead = 0.35) => { let i = -1; plan.lines.forEach((x, k) => { if (x.t - lead <= t) i = k; }); return i; };
    const onBeat = (t) => { const x = (t - beat0) / beat, n = Math.floor(x); return { n, dt: (x - n) * beat, bar: ((n % 4) + 4) % 4 }; };
    const section = (r) => (r?.section || "Intro");
    // set a line's words in rows no wider than `width`; every piece keeps the time of the word it came from
    function setLine(text, times, font, width, upper = false) {
      const key = font + "|" + width + "|" + upper + "|" + text;
      if (cache.has(key)) return cache.get(key);
      ctx.font = font;
      const words = (upper ? text.toUpperCase() : text).split(/\s+/).filter(Boolean), pieces = [];
      words.forEach((w, i) => {
        const ti = times[Math.min(i, times.length - 1)];
        while (ctx.measureText(w).width > width && w.length > 2) {
          let k = w.length; while (k > 1 && ctx.measureText(w.slice(0, k) + "-").width > width) k--;
          pieces.push({ w: w.slice(0, k) + "-", t: ti, i }); w = w.slice(k);
        }
        pieces.push({ w, t: ti, i });
      });
      const sp = ctx.measureText(" ").width, rows = []; let row = [], x = 0;
      for (const p of pieces) {
        p.adv = ctx.measureText(p.w).width;
        if (row.length && x + sp + p.adv > width) { rows.push({ items: row, w: x }); row = []; x = 0; }
        p.x = x + (row.length ? sp : 0); x = p.x + p.adv; row.push(p);
      }
      if (row.length) rows.push({ items: row, w: x });
      const res = { rows, sp };
      cache.set(key, res);
      return res;
    }
    const wordTimes = (r) => r.words.map((w) => w[1]);
    const nextWordT = (r, i) => (i + 1 < r.words.length ? r.words[i + 1][1] : Math.min(r.next ?? r.t + 3, r.words[i][1] + 0.7));
    const isNow = (r, p, t) => p.t <= t && t < nextWordT(r, p.i);
    function grainPass(alpha) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = ctx.createPattern(grain[still() ? 0 : frameNo++ % 3], "repeat"); ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const fadeInOut = (t) => clamp01(Math.min(t / 0.8, (plan.total - t) / 1.2));

    // credits and the end card, set in each look's type and colours
    function credits(t, s) {
      let y = H - (t - plan.roll_start) * plan.speed + 40;
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      for (const [row, h] of plan.credits || []) {
        const i = row.indexOf(":"), kind = row.slice(0, i), text = row.slice(i + 1);
        if (y > -200 && y < H + 10) {
          if (kind === "label") { ctx.font = s.label(24); ctx.fillStyle = rgb(s.acc); ctx.fillText(s.caps ? text.toUpperCase() : text, s.x, y + 30); }
          else if (kind === "big") { ctx.font = s.big(76); ctx.fillStyle = rgb(s.ink); ctx.fillText(text, s.x, y + 20); }
          else if (kind === "person") {
            const j = text.indexOf("|");
            ctx.font = s.big(50); ctx.fillStyle = rgb(s.ink); ctx.fillText(text.slice(0, j).slice(0, 40), s.x, y + 4);
            ctx.font = s.label(26); ctx.fillStyle = rgb(s.ink, 0.6); ctx.fillText(text.slice(j + 1).slice(0, 60), s.x + 2, y + 66);
          }
        }
        y += h;
      }
      if (t > plan.end_card - 0.5) {
        const p = ease((t - plan.end_card + 0.5) / 0.8);
        ctx.fillStyle = rgb(s.bg, p * 0.92); ctx.fillRect(0, 0, W, H);
        ctx.font = s.big(140); ctx.fillStyle = rgb(s.ink, p); ctx.fillText("thanks for listening", s.x, 400 + (still() ? 0 : 24 * (1 - p)));
        ctx.font = s.label(30); ctx.fillStyle = rgb(s.acc, p); ctx.fillText("github.com/nishal21", s.x + 4, 580);
      }
    }


    const GREENS = [[22, 27, 34], [14, 68, 41], [0, 109, 50], [38, 166, 65], [57, 211, 83]];
    const NIGHT = [[17, 21, 27], [26, 48, 46], [38, 80, 70], [72, 130, 108], [146, 200, 166]];
    // the light page's versions: GitHub's own light-theme greens, and a pale sea-glass for the acoustic
    const GREENS_DAY = [[232, 236, 232], [172, 230, 182], [102, 204, 128], [48, 161, 78], [30, 116, 56]];
    const GLASS_DAY = [[230, 236, 236], [204, 222, 218], [170, 204, 194], [124, 172, 156], [82, 136, 118]];
    let gridArt = null;
    function gridBuild(pal) {
      const ws = (weeks || []).filter((w) => w && w.start && w.days?.length);
      const cols = Math.max(1, ws.length), C = 12, c = document.createElement("canvas");
      c.width = cols * C + C * 8; c.height = 7 * C + C * 2;
      const g = c.getContext("2d");
      const max = Math.max(1, ...ws.flatMap((w) => w.days));
      ws.forEach((w, i) => w.days.forEach((n, d) => {
        const lv = n <= 0 ? 0 : Math.min(4, 1 + Math.floor(3.999 * Math.sqrt(n / max)));
        g.fillStyle = rgb(pal[lv]); g.fillRect(C * 4 + i * C + 1.5, C + d * C + 1.5, C - 3, C - 3);
      }));
      return { c, cols, C, ws };
    }

    /* ---------- MIX: Grid's real contribution graph as the moving, out-of-focus background; Poster's huge kinetic
       type for the line being sung, punching on the beat and flipping colour between verse and chorus; Synced's
       word-by-word light-up, with the line before and the line after shown small, dim and blurred around it.
       No corner captions: the page already names the song, and they'd be unreadable on a phone. ---------- */
    const MIX = {
      rap: { pal: GREENS, base: [5, 9, 7], cell: 96, sharp: 3, plate: 0.55,
             Verse: { tint: [0, 0, 0, 0], ink: [236, 242, 236], now: [86, 214, 118] },
             Chorus: { tint: [14, 52, 30, 0.5], ink: [86, 214, 118], now: [250, 255, 250] } },
      calm: { pal: NIGHT, base: [8, 11, 14], cell: 108, sharp: 7, plate: 0.75,
              Verse: { tint: [0, 0, 0, 0], ink: [228, 234, 228], now: [156, 216, 176] },
              Chorus: { tint: [16, 44, 40, 0.45], ink: [214, 236, 222], now: [255, 255, 255] } },
    };
    const MIX_DAY = {
      rap: { pal: GREENS_DAY, base: [240, 243, 240], cell: 96, sharp: 3, plate: 0.6, day: true,
             Verse: { tint: [0, 0, 0, 0], ink: [14, 24, 17], now: [24, 128, 58] },
             Chorus: { tint: [206, 234, 212, 0.55], ink: [24, 116, 54], now: [8, 14, 10] } },
      calm: { pal: GLASS_DAY, base: [238, 242, 242], cell: 108, sharp: 7, plate: 0.7, day: true,
              Verse: { tint: [0, 0, 0, 0], ink: [26, 34, 32], now: [34, 118, 84] },
              Chorus: { tint: [212, 230, 224, 0.5], ink: [28, 64, 50], now: [10, 18, 16] } },
    };
    const mixLook = (M, name) => (/Chorus|Hook/.test(String(name || "")) ? M.Chorus : M.Verse);
    let mixArt = null;
    function mixRows(r, rap, COL, cap) {
      const key = "M" + r.t + rap;
      if (cache.has(key)) return cache.get(key);
      const font = (s) => `${rap ? 820 : 360} ${s}px LVArchivo, sans-serif`;
      const ws = (rap ? r.text.toUpperCase() : r.text).split(/\s+/).filter(Boolean), times = wordTimes(r);
      const n = Math.min(ws.length, ws.length >= (rap ? 6 : 7) ? 3 : ws.length >= 3 ? 2 : 1);
      const chars = ws.join(" ").length, rw = []; let row = [], len = 0;
      ws.forEach((w, i) => {
        if (row.length && rw.length < n - 1 && len + w.length / 2 > chars * (rw.length + 1) / n) { rw.push(row); row = []; }
        row.push({ w, t: times[Math.min(i, times.length - 1)], i }); len += w.length + 1;
      });
      rw.push(row);
      ctx.font = font(100); ctx.fontStretch = rap ? "extra-condensed" : "normal";
      const sp = ctx.measureText(" ").width;
      const rows = rw.map((items) => { let x = 0; items.forEach((p, j) => { p.adv = ctx.measureText(p.w).width; p.x = x + (j ? sp : 0); x = p.x + p.adv; }); return { items, w: x, size: Math.min(cap, 100 * COL / x) }; });
      const lead = rap ? 0.88 : 1.04, room = 560, tot = rows.reduce((a, x) => a + x.size * lead, 0);
      if (tot > room) rows.forEach((x) => (x.size *= room / tot));
      const res = { rows, lead, h: rows.reduce((a, x) => a + x.size * lead, 0), font };
      cache.set(key, res); ctx.fontStretch = "normal";
      return res;
    }
    function mix(t) {
      const rap = mood === "rap", M = (night && !night() ? MIX_DAY : MIX)[rap ? "rap" : "calm"];
      ctx.fillStyle = rgb(M.base); ctx.fillRect(0, 0, W, H);
      const { dt, bar } = onBeat(t);
      // the year's graph, travelled through as the song plays
      if (weeks && (!mixArt || mixArt.pal !== M.pal)) { mixArt = gridBuild(M.pal); mixArt.pal = M.pal; }
      if (mixArt) {
        const { c, cols, C } = mixArt, k = M.cell / C, gw = c.width * k, gh = c.height * k;
        const prog = clamp01(t / Math.max(1, plan.roll_start));
        const zoom = 1 + (rap && !still() ? (bar === 0 ? 0.03 : 0.008) * Math.exp(-dt / 0.14) : 0);
        const focus = (C * 4 + (cols - 1) * C * prog + C / 2) * k;
        const y0 = (H - gh) / 2 + (still() ? 0 : (rap ? 10 : 22) * Math.sin(t * 0.2));
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.filter = "blur(40px)"; ctx.globalAlpha = 0.8; ctx.drawImage(c, W * 0.5 - focus, y0, gw, gh);
        ctx.filter = `blur(${M.sharp}px)`; ctx.globalAlpha = M.plate; ctx.drawImage(c, W * 0.5 - focus, y0, gw, gh);
        ctx.restore(); ctx.filter = "none"; ctx.globalAlpha = 1;
      }
      const idx = lineAt(t, rap ? 0.12 : 0.6), cur = Math.max(0, idx), r = plan.lines[cur];
      let L = mixLook(M, t >= plan.roll_start ? "Outro" : section(r));
      if (idx > 0 && mixLook(M, plan.lines[idx - 1].section) !== L) {   // rap cuts on the line, calm eases over 1.2 s
        const A = mixLook(M, plan.lines[idx - 1].section), k = rap ? 1 : easeIO((t - (r.t - 0.6)) / 1.2);
        L = { tint: A.tint.map((v, i) => v + (L.tint[i] - v) * k), ink: lerpC(A.ink, L.ink, k), now: lerpC(A.now, L.now, k) };
      }
      if (L.tint[3] > 0) { ctx.fillStyle = `rgba(${L.tint.slice(0, 3).map(Math.round)},${L.tint[3]})`; ctx.fillRect(0, 0, W, H); }
      // shade so the words always win over the cells
      const sh = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, W * 0.62);
      if (M.day) { sh.addColorStop(0, "rgba(250,252,250,0.62)"); sh.addColorStop(1, "rgba(250,252,250,0.2)"); }
      else { sh.addColorStop(0, "rgba(0,0,0,0.5)"); sh.addColorStop(1, "rgba(0,0,0,0.2)"); }
      ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
      // rap: a short flash of the chorus colour on the first beat of a new section
      if (rap && !still() && idx > 0 && plan.lines[idx - 1].section !== r.section) {
        const f = t - r.t; if (f >= -0.02 && f < 0.16) { ctx.fillStyle = rgb(L.now, 0.18 * (1 - Math.max(0, f) / 0.16)); ctx.fillRect(0, 0, W, H); }
      }
      if (t >= plan.roll_start) { grainPass(0.06); return credits(t, { x: 140, ink: L.ink, acc: L.now, bg: M.base, big: (s) => `${rap ? 800 : 400} ${s}px LVArchivo, sans-serif`, label: (s) => `500 ${s}px LVInter, sans-serif` }); }
      if (idx < 0) { grainPass(0.06); return; }
      const X = 140, COL = W - 2 * X, cap = rap ? 230 : 160, SMALL = rap ? 46 : 44;
      const smallFont = `${rap ? 700 : 450} ${SMALL}px LVInter, sans-serif`;
      const comp = mixRows(r, rap, COL, cap);
      const into = still() ? 1 : rap ? ease((t - (r.t - 0.12)) / 0.16) : easeIO((t - (r.t - 0.6)) / 0.9);
      const top = (H - comp.h) / 2 + 20;
      const punch = rap && !still() && bar === 0 ? 0.02 * Math.exp(-dt / 0.1) : 0;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1 + punch, 1 + punch); ctx.translate(-W / 2, -H / 2);
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      // the lines either side: small, dim, blurred
      const side = (k, y, dir) => {
        const ln = plan.lines[k]; if (!ln) return;
        const s = setLine(ln.text, wordTimes(ln), smallFont, COL);
        const hh = s.rows.length * SMALL * 1.15, yy = dir < 0 ? y - hh : y;
        ctx.save(); ctx.font = smallFont; if (!still()) ctx.filter = `blur(${dir < 0 ? 2.5 : 1.8}px)`;
        ctx.globalAlpha = (dir < 0 ? 0.32 : 0.42) * into;
        s.rows.forEach((row, ri) => row.items.forEach((p) => { ctx.fillStyle = rgb(L.ink); ctx.fillText(p.w, X + p.x, yy + ri * SMALL * 1.15); }));
        ctx.restore();
      };
      side(cur - 1, top - 56, -1);
      side(cur + 1, top + comp.h + 44, 1);
      // the outgoing line slides into the small slot above while the new one comes in from below
      if (!still() && cur > 0 && into < 1) {
        const pc = mixRows(plan.lines[cur - 1], rap, COL, cap);
        let y = top - 70 * into;
        ctx.save(); ctx.globalAlpha = 1 - into; ctx.filter = `blur(${(3 * into).toFixed(1)}px)`;
        for (const row of pc.rows) { ctx.font = pc.font(row.size); ctx.fontStretch = rap ? "extra-condensed" : "normal"; ctx.fillStyle = rgb(L.ink, 0.8);
          for (const p of row.items) ctx.fillText(p.w, X + p.x * row.size / 100, y - row.size * 0.06); y += row.size * pc.lead; }
        ctx.restore();
      }
      // the line being sung: huge, each row stretched across, lit word by word
      let y = top + (still() ? 0 : (rap ? 26 : 40) * (1 - into));
      for (const row of comp.rows) {
        const k = row.size / 100;
        ctx.font = comp.font(row.size); ctx.fontStretch = rap ? "extra-condensed" : "normal";
        for (const p of row.items) {
          const now = isNow(r, p, t);
          const lit = still() ? 1 : rap ? (p.t <= t ? 1 : 0) : ease((t - p.t + 0.05) / 0.55);
          const a = ((M.day ? 0.24 : 0.2) + (M.day ? 0.76 : 0.8) * lit) * into;
          if (a <= 0.01) continue;
          const pop = rap && now && !still() ? 1 + 0.07 * Math.exp(-(t - p.t) / 0.07) : 1;
          ctx.save(); ctx.translate(X + p.x * k, y + row.size * 0.5); ctx.scale(pop, pop);
          if (now && !rap && !still() && !M.day) { ctx.shadowColor = rgb(L.now, 0.5); ctx.shadowBlur = 30; }
          ctx.fillStyle = rgb(now ? L.now : L.ink, a); ctx.fillText(p.w, 0, -row.size * 0.56);
          ctx.restore();
        }
        y += row.size * comp.lead;
      }
      ctx.restore(); ctx.fontStretch = "normal";
      grainPass(rap ? 0.05 : 0.07);
    }

    let frameNo = 0;
    function draw() {
      if (dead || !plan) return;
      const t = video.currentTime || 0;
      ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.filter = "none"; ctx.globalAlpha = 1;
      mix(t);
      ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.filter = "none";
      const k = fadeInOut(t);
      if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - k})`; ctx.fillRect(0, 0, W, H); }
      onFrame?.(canvas);
    }
    function loop() { cancelAnimationFrame(raf); if (dead) return; draw(); if (!video.paused) raf = requestAnimationFrame(loop); }
    const kick = () => draw();
    for (const e of ["seeked", "timeupdate", "loadedmetadata"]) video.addEventListener(e, kick);
    video.addEventListener("play", loop);
    size();
    Promise.all([fetch(planUrl).then((r) => r.json()), loadFonts(),
      fetch("../player/contribution-song.json").then((r) => r.json()).then((s) => { weeks = s.weeks; }).catch(() => {})]).then(([p]) => {
      if (dead) return;
      plan = p;
      mood = p.mood || (/acoustic/.test(planUrl) ? "calm" : "rap");
      beat = 60 / (+p.bpm || (mood === "calm" ? 76 : 140)); beat0 = +p.beat0 || 0;
      stage.classList.add("lyric-on"); cache.clear(); draw(); loop();
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
  window.SongVideo = { attach };
})();
