/* The visitor song's lyric video, drawn live over the song (the same look as scripts/visitor_video.py renders to MP4):
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
                   new FontFace("LVMono", "url(../player/fonts/jetbrains-mono.woff2)", { weight: "100 800" })];
    fontsReady = Promise.all(faces.map((f) => f.load().then((x) => document.fonts.add(x)).catch(() => null)));
    return fontsReady;
  }
  const F = (size, w = 800) => `${w} ${size}px LVDisplay, system-ui, sans-serif`;
  const M = (size, w = 500) => `${w} ${size}px LVMono, ui-monospace, monospace`;

  function attach({ stage, video, planUrl, reduce }) {
    const canvas = document.createElement("canvas");
    canvas.className = "lyric-canvas";
    canvas.setAttribute("aria-hidden", "true");
    video.after(canvas);
    const ctx = canvas.getContext("2d");
    let plan = null, dead = false, raf = 0, scale = 1;
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

    function layout(text) {
      if (wrapCache.has(text)) return wrapCache.get(text);
      const words = text.split(/\s+/).filter(Boolean);
      let res = null;
      for (const s of [112, 100, 88, 76, 66, 58, 50, 44]) {
        ctx.font = F(s);
        const rows = wrap(words, TEXT_W);
        res = { size: s, rows };
        if (rows.length <= 3) break;
      }
      wrapCache.set(text, res);
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
      if (t < plan.first - 0.5) return plan.looks.Intro;
      if (t >= plan.roll_start) return plan.looks.Credits;
      const [r] = current(t);
      return plan.looks[r?.section] || plan.looks.Verse;
    }

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
      const { size: fs, rows } = r.rows ? { size: r.size, rows: r.rows } : layout(r.text);
      const lh = Math.round(fs * 1.08), block = lh * rows.length;
      const leave = ease((t - (stop - 0.35)) / 0.35);
      const y0 = (TOP + BOTTOM) / 2 - block / 2 - 40 + drift[1] - (still() ? 0 : 30 * leave);
      const x0 = TEXT_X + drift[0];
      const ghost = L.bg.map((c, i) => Math.round(c * 0.78 + L.ink[i] * 0.22));
      const times = r.words.map((w) => w[1]);
      ctx.font = F(fs); ctx.textBaseline = "top";
      const sp = ctx.measureText(" ").width;
      let k = 0, sung = null;
      const pre = still() ? 1 : ease((t - start) / 0.5);
      rows.forEach((row, ri) => {
        let x = x0;
        for (const w of row) {
          const wt = times[Math.min(k, times.length - 1)];
          if (!w.endsWith("-")) k++;
          const adv = ctx.measureText(w).width, y = y0 + ri * lh;
          const lit = ease((t - wt) / 0.28), a = 1 - leave;
          if (lit < 1) { ctx.fillStyle = rgb(ghost, pre * a); ctx.fillText(w, x, y); }
          if (lit > 0) { ctx.fillStyle = rgb(L.ink, lit * a); ctx.fillText(w, x, y + (still() ? 0 : 18 * (1 - lit))); }
          const nxt = k < times.length ? times[k] : wt + 0.6;
          if (wt <= t && t < nxt) sung = [x, y, adv];
          x += adv + sp;
        }
      });
      if (sung && leave < 0.5) { ctx.fillStyle = rgb(L.acc); ctx.fillRect(sung[0], sung[1] + fs * 1.02, sung[2], 7); }
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
      putDrawing("line" + idx, L, start + 0.15, stop, t, drift);
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
        ctx.font = F(150); ctx.fillStyle = rgb(L.ink, p); ctx.fillText("add your line", TEXT_X, 380 + (still() ? 0 : 30 * (1 - p)) + 12);
        ctx.font = M(32); ctx.fillStyle = rgb(L.acc, p); ctx.fillText("github.com/nishal21 · leave a note on the profile", TEXT_X + 6, 590);
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
      const drift = still() ? [0, 0] : [6 * Math.sin(t * 0.21), 4 * Math.cos(t * 0.17)];
      const L = lookAt(t);
      ctx.fillStyle = rgb(L.bg); ctx.fillRect(0, 0, W, H);
      if (t < plan.first - 0.5) title(t, L, drift);
      else if (t >= plan.roll_start) credits(t, L, drift);
      else lyric(t, L, drift);
      if (!still()) wipe(t);
      // grain, then the letterbox
      ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = "overlay";
      const g = grain[still() ? 0 : frameNo++ % 4];
      ctx.fillStyle = ctx.createPattern(g, "repeat"); ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, TOP); ctx.fillRect(0, BOTTOM, W, H - BOTTOM);
      const k = Math.min(1, t / 0.8, Math.max(0, (plan.total - t) / 1.2));
      if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, k)})`; ctx.fillRect(0, 0, W, H); }
    }
    function loop() { cancelAnimationFrame(raf); if (dead) return; draw(); if (!video.paused) raf = requestAnimationFrame(loop); }
    const kick = () => draw();
    for (const e of ["seeked", "timeupdate", "loadedmetadata"]) video.addEventListener(e, kick);
    video.addEventListener("play", loop);

    size();
    Promise.all([fetch(planUrl).then((r) => r.json()), loadFonts()]).then(([p]) => {
      if (dead) return;
      plan = p; stage.classList.add("lyric-on"); wrapCache.clear(); draw(); loop();
    }).catch(() => canvas.remove());
    return {
      destroy() {
        dead = true; cancelAnimationFrame(raf); ro?.disconnect(); canvas.remove(); stage.classList.remove("lyric-on");
        for (const e of ["seeked", "timeupdate", "loadedmetadata"]) video.removeEventListener(e, kick);
        video.removeEventListener("play", loop);
      },
    };
  }
  window.LyricVideo = { attach };
})();
