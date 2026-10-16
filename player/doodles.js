// Page doodles: each look scatters its own Open Doodles (CC0) into empty parts of the page.
// Free space is worked out from the boxes of everything visible (text, controls, cover, panels, lyrics),
// so a doodle never covers content and never widens the page. Entrance: the outline draws itself on like
// a pen line, then the fill settles in, and a one-word caption types in and tracks out a little.
// With prefers-reduced-motion everything just appears. Decorative only: aria-hidden, no pointer events.
(() => {
  const SETS = {
    vinyl: [["chilling", "side b"], ["float", "hum"], ["laying", "spin"]],
    poster: [["levitate", "loud"], ["roller-skating", "move"], ["strolling", "go on"]],
    editorial: [["reading", "listen*"], ["sitting-reading", "issue 01"], ["meditating", "slow"]],
    sketch: [["coffee", "doodle"], ["swinging", "la la"], ["plant", "hmm"]],
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
      if (e === layer || layer.contains(e) || e.id === "bg" || e.closest("#lyrics-pane, #remix-pane")) continue;
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
    set.forEach(([name, word], i) => {
      if (!texts[i]) return;
      for (let tries = 0; tries < 400; tries++) {
        const w = Math.round((small ? 64 : 96) + rnd() * (small ? 30 : 56)), h = Math.round(w * 0.75);
        const capH = 20;
        const x = 8 + rnd() * (W - w - 16), y = 70 + rnd() * (H - h - capH - 90);
        const box = [x, y, x + w, y + h + capH];
        if (box[2] > W - 4 || hit(box, block) || hit(box, placed.map((p) => [p[0] - 24, p[1] - 24, p[2] + 24, p[3] + 24]))) continue;
        placed.push(box);
        const fig = document.createElement("figure");
        fig.className = "doodle";
        fig.style.cssText = `left:${x}px;top:${y}px;width:${w}px;--rot:${(rnd() * 12 - 6).toFixed(1)}deg;--d:${i * 0.5}s`;
        fig.innerHTML = texts[i].replace('fill="#000"', `fill="${ink}"`).replace('fill="#FF5678"', `fill="${acc}"`)
          .replace("<svg ", '<svg focusable="false" ');
        fig.querySelectorAll("path").forEach((p) => { p.setAttribute("pathLength", "1"); p.style.stroke = p.getAttribute("fill") || "currentColor"; });
        const cap = document.createElement("figcaption");
        [...word].forEach((ch, k) => { const s = document.createElement("span"); s.textContent = ch; s.style.setProperty("--k", k); cap.append(s); });
        fig.append(cap);
        if (animate && !reduce.matches) fig.classList.add("enter");
        layer.append(fig);
        break;
      }
    });
  }
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
