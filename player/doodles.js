// Page doodles: each look scatters its own Open Doodles (CC0) into empty parts of the page.
// Free space is worked out from the boxes of everything visible (text, controls, cover, panels, lyrics),
// so a doodle never covers content and never widens the page. Entrance: the outline draws itself on like
// a pen line, then the fill settles in, and a one-word caption types in and tracks out a little.
// With prefers-reduced-motion everything just appears. Decorative only: aria-hidden, no pointer events.
(() => {
  const SETS = {
    vinyl: [["chilling", "side b"], ["float", "hum"], ["laying", "spin"], ["sitting", "b-side"], ["sleek", "groove"], ["loving", "encore"]],
    poster: [["levitate", "loud"], ["roller-skating", "move"], ["strolling", "go on"], ["jumping", "jump"], ["running", "faster"], ["dog-jump", "woof"]],
    editorial: [["reading", "listen*"], ["sitting-reading", "issue 01"], ["meditating", "slow"], ["reading-side", "notes"], ["petting", "pause"], ["selfie", "cover"]],
    sketch: [["coffee", "doodle"], ["swinging", "la la"], ["plant", "hmm"], ["ice-cream", "sweet"], ["unboxing", "new!"], ["doggie", "good boy"]],
  };
  const src = {};
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const layer = document.createElement("div");
  layer.className = "doodles";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const get = (n) => src[n] || (src[n] = fetch(`art/page/${n}.svg`).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  const color = (v) => { const i = document.createElement("i"); i.style.color = v; layer.append(i); const c = getComputedStyle(i).color; i.remove(); return c; };

  // everything a doodle must stay clear of, in page coordinates
  function obstacles() {
    const out = [], sx = scrollX, sy = scrollY;
    const push = (r, pad) => { if (r.width && r.height) out.push([r.left + sx - pad, r.top + sy - pad, r.right + sx + pad, r.bottom + sy + pad]); };
    for (const e of document.body.querySelectorAll("*")) {
      if (e === layer || layer.contains(e) || e.id === "bg" || e.closest("#lyrics-pane")) continue;
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" && e.id === "bg") continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const solid = /CANVAS|IMG|SVG|BUTTON|INPUT|SELECT|TEXTAREA|VIDEO|svg/.test(e.tagName) ||
        cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent" ||
        parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0;  // a boxed panel, not a divider line
      const r = e.getBoundingClientRect();
      // page-wide wrappers with a background are not content; real panels are narrower than the page
      if (own || solid && (r.width < innerWidth * 0.9 || /CANVAS|IMG|svg|VIDEO/.test(e.tagName))) push(r, 14);
    }
    for (const id of ["lyrics-pane", "remix-pane"]) { const e = document.getElementById(id); if (e) push(e.getBoundingClientRect(), 18); }
    // the lyrics column is sticky, so it sweeps the whole height of the deck as the page scrolls: block all of it
    const lp = document.getElementById("lyrics-pane"), np = document.querySelector(".np");
    if (lp && np && lp.offsetParent) {
      const a = lp.getBoundingClientRect(), b = np.getBoundingClientRect();
      push({ left: a.left, right: a.right, top: b.top, bottom: b.bottom, width: 1, height: 1 }, 24);
    }
    // keep out of the content columns themselves: every section, deck part, header and footer line
    for (const e of document.querySelectorAll(".notes .block-head, .notes .grid-scroll, .notes .bar-now, .notes .stats, .notes .tracklist, .top, .foot > *")) {
      if (e.offsetParent !== null || getComputedStyle(e).position === "fixed") push(e.getBoundingClientRect(), 12);
    }
    return out;
  }
  const hit = (a, list) => list.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);

  let seq = 0;
  async function layout(animate = true) {
    const my = ++seq;
    const set = SETS[root.dataset.persona] || SETS.vinyl;
    const texts = await Promise.all(set.map(([n]) => get(n)));
    if (my !== seq) return;
    layer.replaceChildren();
    layer.style.height = "0px";
    const W = document.documentElement.clientWidth, H = document.documentElement.scrollHeight;
    layer.style.height = H + "px";
    const block = obstacles(), placed = [];
    const small = W < 600, ink = color("var(--fg-2)"), acc = color("var(--accent)");
    const rnd = Math.random;
    // how many: about one per screenful of page, more on wide screens with real gutters, few on phones
    const want = Math.max(2, Math.min(small ? 4 : 12, Math.round((H / innerHeight) * (small ? 0.8 : W >= 1100 ? 2.4 : 1.6))));
    const gap = small ? 140 : 190;  // minimum distance between doodles (Poisson-disc style)
    const sizes = small ? [84, 72, 64] : [140, 120, 104, 90, 78, 68, 60];
    const capH = 20, step = 12;
    // free spots for every size on a coarse grid
    const order = [...set.keys()].sort(() => rnd() - 0.5);
    let k = 0;
    const free = sizes.map((w) => {
      const h = Math.round(w * 0.75), list = [];
      for (let y = 64; y + h + capH < H - 16; y += step)
        for (let x = 8; x + w < W - 8; x += step) {
          const box = [x, y, x + w, y + h + capH];
          if (!hit(box, block)) list.push(box);
        }
      return list;
    });
    const far = (box) => { const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      return !placed.some((p) => Math.hypot((p[0] + p[2]) / 2 - cx, (p[1] + p[3]) / 2 - cy) < gap); };
    // stratified: split the page into equal bands and give each band one doodle, so they spread over the whole height
    const picks = [];
    const bands = want, bh = H / bands;
    const bandOrder = [...Array(bands).keys()].sort(() => rnd() - 0.5);
    for (const pass of [0, 1]) for (const bi of bandOrder) {
      if (picks.length >= want) break;
      if (pass === 0 && picks.some((p) => p.band === bi)) continue;
      let got = null;
      for (let si = 0; si < sizes.length && !got; si++) {
        const c = free[si].filter((bx) => { const cy = (bx[1] + bx[3]) / 2; return cy >= bi * bh && cy < (bi + 1) * bh && far(bx); });
        if (c.length) got = { box: c[Math.floor(rnd() * c.length)], w: sizes[si] };
      }
      if (got) { placed.push(got.box); picks.push({ ...got, band: bi }); }
    }
    for (const { box, w } of picks) {
      {
        const idx = order[k % order.length], [, word] = set[idx], text = texts[idx]; k++;
        if (!text) continue;
        const fig = document.createElement("figure");
        fig.className = "doodle";
        fig.style.cssText = `left:${box[0]}px;top:${box[1]}px;width:${w}px;--rot:${(rnd() * 10 - 5).toFixed(1)}deg;--d:${(k - 1) * 0.35}s`;
        fig.innerHTML = text.replace('fill="#000"', `fill="${ink}"`).replace('fill="#FF5678"', `fill="${acc}"`).replace("<svg ", '<svg focusable="false" ');
        fig.querySelectorAll("path").forEach((p) => { p.setAttribute("pathLength", "1"); p.style.stroke = p.getAttribute("fill") || "currentColor"; });
        const cap = document.createElement("figcaption");
        [...word].forEach((ch, n) => { const sp = document.createElement("span"); sp.textContent = ch; sp.style.setProperty("--k", n); cap.append(sp); });
        fig.append(cap);
        if (animate && !reduce.matches) fig.classList.add("enter");
        layer.append(fig);
      }
    }
    revalidate();
  }
  // lyrics move (scrolling, staggered lines): every second, fade out any doodle a visible line now touches
  function revalidate() {
    const figs = layer.querySelectorAll(".doodle");
    if (!figs.length) return;
    const sx = scrollX, sy = scrollY, boxes = [];
    for (const e of document.querySelectorAll("#lyrics-pane .ly, #lyrics-pane .line, #lyrics-pane .ly-sec, .now-badge .chip")) {
      // lines scrolled out of the pane are clipped, so only the part inside the pane counts
      const r = e.getBoundingClientRect(), c = (e.closest("#lyrics-pane") || document.documentElement).getBoundingClientRect();
      const t = Math.max(r.top, c.top), bt = Math.min(r.bottom, c.bottom);
      if (r.width && bt > t) boxes.push([r.left + sx - 16, t + sy - 16, r.right + sx + 16, bt + sy + 16]);
    }
    figs.forEach((f) => {
      const r = f.getBoundingClientRect(), b = [r.left + sx, r.top + sy, r.right + sx, r.bottom + sy];
      f.classList.toggle("away", hit(b, boxes));
    });
  }
  setInterval(() => { if (!document.hidden) revalidate(); }, 1000);
  let t = 0;
  const later = (anim) => { clearTimeout(t); t = setTimeout(() => layout(anim), 250); };
  let lastW = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) > 2) { lastW = innerWidth; later(false); } });
  // re-place quietly if the page grows or shrinks (song data, liner notes), redraw when the look changes
  let lastH = 0;
  new ResizeObserver(() => { const h = document.body.scrollHeight; if (Math.abs(h - lastH) > 40) { lastH = h; later(lastH === 0); } }).observe(document.body);
  new MutationObserver(() => later(true)).observe(root, { attributes: true, attributeFilter: ["data-persona"] });
  window.layoutDoodles = later;
  window.__doodleBlocks = () => obstacles();
  addEventListener("load", () => setTimeout(() => layout(true), 400));
})();
