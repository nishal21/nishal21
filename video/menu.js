/* A right-click menu for the players, like YouTube's: links, loop, speed, picture-in-picture, a frame grab,
   stats for nerds and the shortcuts. The menu itself is generic; the video page and the song player each
   wire their own items at the bottom. Touch screens open it from a ⋮ button, because a long press on the
   video means 2× (gestures.js). */
(() => {
  "use strict";
  const ICON = {
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
    loop: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
    speed: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>',
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
    stats: '<path d="M5 19V11M10 19V5M15 19v-6M20 19V8"/>',
    keys: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    remix: '<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 15h4M10 8h4M16 13h4"/>',
    tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
  };
  const svg = (name, cls = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${ICON[name] || ""}</svg>`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };

  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = Object.assign(document.createElement("div"), { className: "cm-toast", role: "status" }); toastEl.setAttribute("aria-live", "polite"); }
    (fsEl() || document.body).append(toastEl);
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }
  async function copyText(text, msg, say = toast) {
    try { await navigator.clipboard.writeText(text); say(msg); }
    catch { prompt("Copy this", text); }
  }

  /* ---------- the menu ----------
     items(): [{ label, icon, hint, run, disabled, checked (true/false makes a checkbox), switch, radio, sub: () => items }, "-"] */
  function contextMenu({ label, items }) {
    let root = null, sub = null, opener = null, subTimer = 0, rightClosedAt = -1e9;

    function build(list, name) {
      const m = document.createElement("div");
      m.className = "cm";
      m.setAttribute("role", "menu");
      m.setAttribute("aria-label", name);
      m.tabIndex = -1;
      for (const it of list) {
        if (it === "-") { const s = document.createElement("div"); s.className = "cm-sep"; s.setAttribute("role", "separator"); m.append(s); continue; }
        if (it.head) { const h = document.createElement("div"); h.className = "cm-head"; h.textContent = it.head; m.append(h); continue; }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cm-row";
        b.tabIndex = -1;
        const role = it.radio ? "menuitemradio" : typeof it.checked === "boolean" ? "menuitemcheckbox" : "menuitem";
        b.setAttribute("role", role);
        if (role !== "menuitem") b.setAttribute("aria-checked", String(!!it.checked));
        if (it.sub) { b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false"); }
        if (it.disabled) b.setAttribute("aria-disabled", "true");
        const icon = role !== "menuitem" && !it.switch ? svg("tick", "cm-tick") : svg(it.icon);
        const end = it.switch ? '<span class="cm-sw" aria-hidden="true"></span>' : '<span class="cm-hint"></span>';
        b.innerHTML = `${it.switch ? svg(it.icon) : icon}<span class="cm-label"></span>${end}${it.sub ? svg("chev", "cm-chev") : ""}`;
        b.querySelector(".cm-label").textContent = it.label;
        if (!it.switch) b.querySelector(".cm-hint").textContent = it.hint || "";
        if (it.sub) b.classList.add("cm-has-sub");
        b._it = it;
        m.append(b);
      }
      m.addEventListener("click", onClick);
      m.addEventListener("keydown", onKey);
      m.addEventListener("pointermove", onHover);
      m.addEventListener("contextmenu", (e) => e.preventDefault());
      return m;
    }
    const rows = (m) => [...m.querySelectorAll(".cm-row")].filter((b) => b.getAttribute("aria-disabled") !== "true");

    function place(m, x, y, { flipX = 0 } = {}) {
      const vw = Math.min(document.documentElement.clientWidth, innerWidth, visualViewport?.width || Infinity), vh = Math.min(innerHeight, visualViewport?.height || Infinity), r = { width: m.offsetWidth, height: m.offsetHeight }; // offset sizes: the opening animation scales it
      let left = x, top = y, ox = "left", oy = "top";
      if (left + r.width > vw - 8) { left = flipX ? flipX - r.width : x - r.width; ox = "right"; }
      if (top + r.height > vh - 8) { top = Math.max(8, Math.min(y - r.height, vh - 8 - r.height)); oy = "bottom"; }
      m.style.left = `${clamp(left, 8, Math.max(8, vw - r.width - 8))}px`;
      m.style.top = `${clamp(top, 8, Math.max(8, vh - r.height - 8))}px`;
      m.style.setProperty("--cm-ox", ox);
      m.style.setProperty("--cm-oy", oy);
    }

    function open(x, y, { keyboard = false, from = null } = {}) {
      close(false);
      opener = from || document.activeElement;
      root = build(items(), label);
      root.style.left = "-9999px"; root.style.top = "0";
      (fsEl() || document.body).append(root);
      place(root, x, y);
      if (keyboard) rows(root)[0]?.focus(); else root.focus({ preventScroll: true });
      addEventListener("pointerdown", outside, true);
      addEventListener("scroll", onScroll, true);
      addEventListener("resize", dismiss);
      addEventListener("blur", dismiss);
      document.addEventListener("visibilitychange", dismiss);
    }
    function close(restore = true) {
      closeSub();
      if (!root) return;
      root.remove();
      root = null;
      removeEventListener("pointerdown", outside, true);
      removeEventListener("scroll", onScroll, true);
      removeEventListener("resize", dismiss);
      removeEventListener("blur", dismiss);
      document.removeEventListener("visibilitychange", dismiss);
      if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    }
    const dismiss = () => close(false);
    const outside = (e) => {
      if (e.target.closest?.(".cm")) return;
      if (e.button === 2) rightClosedAt = performance.now(); // a second right-click gets the browser's own menu
      close(false);
    };
    const onScroll = (e) => { if (!(e.target instanceof Element) || !e.target.closest(".cm")) close(false); };

    function openSub(row, focus) {
      if (sub?._row === row) { if (focus) (sub.querySelector('[aria-checked="true"]') || rows(sub)[0])?.focus(); return; }
      closeSub();
      sub = build(row._it.sub(), row._it.label);
      sub._row = row;
      sub.classList.add("cm-sub");
      sub.style.left = "-9999px"; sub.style.top = "0";
      root.after(sub);
      const r = row.getBoundingClientRect();
      place(sub, r.right + 4, r.top - 6, { flipX: r.left - 4 });
      row.setAttribute("aria-expanded", "true");
      row.classList.add("cm-on");
      if (focus) (sub.querySelector('[aria-checked="true"]') || rows(sub)[0])?.focus();
    }
    function closeSub() {
      clearTimeout(subTimer);
      if (!sub) return;
      sub._row.setAttribute("aria-expanded", "false");
      sub._row.classList.remove("cm-on");
      sub.remove();
      sub = null;
    }

    function activate(b, keyboard) {
      const it = b._it;
      if (!it || b.getAttribute("aria-disabled") === "true") return;
      if (it.sub) { openSub(b, true); return; }
      close(true);
      it.run?.();
    }
    function onClick(e) { const b = e.target.closest(".cm-row"); if (b) activate(b); }
    function onHover(e) {
      if (e.pointerType !== "mouse") return;
      const b = e.target.closest(".cm-row");
      if (!b || b.closest(".cm-sub")) return;
      clearTimeout(subTimer);
      if (b._it?.sub && b.getAttribute("aria-disabled") !== "true") subTimer = setTimeout(() => openSub(b, false), 120);
      else if (sub) subTimer = setTimeout(closeSub, 200);
    }
    function onKey(e) {
      const m = e.currentTarget, list = rows(m), i = list.indexOf(document.activeElement);
      const go = (j) => list[(j + list.length) % list.length]?.focus();
      const k = e.key;
      e.stopPropagation(); // the page's own shortcuts stay quiet while the menu has focus
      if (k === "ArrowDown") go(i + 1);
      else if (k === "ArrowUp") go(i < 0 ? -1 : i - 1);
      else if (k === "Home" || k === "PageUp") go(0);
      else if (k === "End" || k === "PageDown") go(-1);
      else if (k === "ArrowRight" && document.activeElement?._it?.sub) openSub(document.activeElement, true);
      else if ((k === "ArrowLeft" || k === "Escape") && m.classList.contains("cm-sub")) { const row = sub._row; closeSub(); row.focus(); }
      else if (k === "Escape") close(true);
      else if (k === "Tab") { close(true); return; }
      else if (k === "Enter" || k === " ") { if (i >= 0) activate(list[i], true); }
      else if (k.length === 1 && /\S/.test(k)) {
        // type to jump, like a native menu
        const n = list.length, l = k.toLowerCase();
        for (let s = 1; s <= n; s++) { const b = list[(i + s) % n]; if (b.querySelector(".cm-label").textContent.toLowerCase().startsWith(l)) { b.focus(); break; } }
      } else return;
      e.preventDefault();
    }
    return { open, close: () => close(true), get isOpen() { return !!root; }, get rightClosedAt() { return rightClosedAt; } };
  }

  /* opens on right-click (the second right-click on an open menu gives the browser's own), Shift+F10 and
     the context-menu key while focus is in `area`; touch long presses are left to the page */
  function attach(area, menu, { canOpen = () => true, keyTarget = (t) => area.contains(t), touch = false } = {}) {
    let lastType = "mouse", keyAt = -1e9;
    area.addEventListener("pointerdown", (e) => { lastType = e.pointerType; }, true);
    area.addEventListener("contextmenu", (e) => {
      // the key that opened the menu also fires this event in some browsers
      if (performance.now() - keyAt < 600 && e.button !== 2) { keyAt = -1e9; e.preventDefault(); return; }
      if (e.target.closest?.(".menu, input, textarea, a[href]")) return;
      if (!touch && (lastType === "touch" || lastType === "pen")) { e.preventDefault(); return; }
      if (menu.isOpen || !canOpen() || performance.now() - menu.rightClosedAt < 1000) { menu.close(); return; }
      e.preventDefault();
      menu.open(e.clientX, e.clientY, { from: area.contains(document.activeElement) ? document.activeElement : null });
    });
    document.addEventListener("keydown", (e) => {
      if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (menu.isOpen || !canOpen() || !keyTarget(e.target)) return;
      if (e.target.closest?.("input:not([type=range]), textarea, select, [contenteditable]")) return;
      e.preventDefault();
      keyAt = performance.now();
      const f = e.target !== document.body && area.contains(e.target) ? e.target.getBoundingClientRect() : area.getBoundingClientRect();
      menu.open(f.left + Math.min(f.width / 2, 160), f.top + Math.min(f.height / 2, 120), { keyboard: true });
    });
  }

  window.contextMenu = { create: contextMenu, attach, toast, copy: copyText };

  /* ---------- the video page ---------- */
  const V = window.videoPage;
  if (V) {
    const RATE_NAME = (r) => (r === 1 ? "Normal" : `${r}×`);
    const timeParam = (t) => Math.floor(t || 0);
    function originalUrl(it, t) {
      if (!it || !it.href) return null;
      if (it.kind === "youtube" && it.id && !it.list) {
        const u = new URL(it.href);
        if (t >= 1) u.searchParams.set("t", `${timeParam(t)}s`);
        return u.href;
      }
      if (it.kind === "vimeo") return t >= 1 ? `${it.href.split("#")[0]}#t=${timeParam(t)}s` : it.href;
      return null;
    }
    const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    function embedCode() {
      const it = V.item, src = V.shareUrl(true);
      const tall = V.stage.dataset.shape === "tall";
      return `<iframe width="${tall ? 315 : 560}" height="${tall ? 560 : 315}" src="${escAttr(src)}" title="${escAttr(it?.title || "Video")}" frameborder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    }

    function items() {
      const it = V.item, P = V.adapter, local = !it || !!it.local || !V.shareUrl(false);
      const t = P?.t || 0, timed = !local && P && !P.embed && t >= 1;
      const rates = V.rates(), playable = !!P && !P.embed;
      const orig = originalUrl(it, playable ? t : 0);
      const list = [
        { label: "Copy video link", icon: "link", disabled: local, run: () => V.copy(V.shareUrl(false), "Link copied") },
        { label: timed ? `Copy link at ${V.fmt(t)}` : "Copy link at current time", icon: "clock", disabled: !timed, run: () => V.copy(V.shareUrl(true), `Link at ${V.fmt(t)} copied`) },
        { label: "Copy embed code", icon: "code", disabled: local, run: () => V.copy(embedCode(), "Embed code copied") },
        "-",
        { label: "Loop", icon: "loop", checked: V.loop, switch: true, disabled: !playable, run: () => { V.setLoop(!V.loop); V.bezel(V.loop ? "Loop on" : "Loop off"); } },
        { label: "Playback speed", icon: "speed", hint: RATE_NAME(V.rate), disabled: !playable || rates.length < 2,
          sub: () => rates.map((r) => ({ label: RATE_NAME(r), radio: true, checked: r === V.rate, run: () => { V.setRate(r); V.bezel(`${r}×`); } })) },
        { label: "Picture-in-picture", icon: "pip", disabled: !V.pipOk(), run: () => V.togglePiP() },
        { label: "Take snapshot", icon: "camera", disabled: !(P?.native && V.video.videoWidth), run: () => V.snapshot() },
        "-",
        { label: "Stats for nerds", icon: "stats", checked: stats.on, switch: true, run: () => stats.toggle() },
        { label: "Keyboard shortcuts", icon: "keys", hint: "?", run: () => V.openKeys() },
      ];
      if (orig) list.push({ label: it.openLabel || "Open original", icon: "out", run: () => window.open(orig, "_blank", "noopener") });
      return list;
    }

    /* stats for nerds: what's playing and how well */
    const stats = (() => {
      let box = null, timer = 0;
      const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd title="${escAttr(v)}">${escAttr(v)}</dd>`);
      function bufferAhead(P) {
        const t = P.t || 0;
        for (const [a, b] of P.buffered?.() || []) if (t >= a - 0.25 && t <= b) return Math.max(0, b - t);
        return 0;
      }
      function codecs(P) {
        const { hls, dash } = V.engines();
        try {
          if (hls && hls.levels?.length) {
            const l = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel] || hls.levels[0];
            return [l.videoCodec, l.audioCodec].filter(Boolean).join(" / ") || l.attrs?.CODECS;
          }
          if (dash) {
            const v = dash.getCurrentTrackFor?.("video"), a = dash.getCurrentTrackFor?.("audio");
            return [v?.codec, a?.codec].filter(Boolean).map((c) => c.replace(/^.*codecs="?([^"]+)"?.*$/, "$1")).join(" / ");
          }
        } catch {}
        return P.native ? null : undefined;
      }
      function paint() {
        const P = V.adapter, it = V.item, vid = V.video;
        if (!box) return;
        const kind = !P ? "Nothing loaded" : P.yt ? "YouTube embed" : P.vimeo ? "Vimeo embed" : P.embed ? "Embedded player" : V.engines().hls ? "HLS (hls.js)" : V.engines().dash ? "DASH (dash.js)" : it?.kind === "hls" ? "HLS (native)" : it?.local ? "Local file" : "Video file";
        const dpr = devicePixelRatio || 1, sr = V.stage.getBoundingClientRect();
        let res = null, drops = null;
        if (P?.native && vid.videoWidth) {
          res = `${vid.videoWidth}×${vid.videoHeight}`;
          const q = vid.getVideoPlaybackQuality?.();
          if (q) drops = `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}`;
          else if ("webkitDroppedFrameCount" in vid) drops = `${vid.webkitDroppedFrameCount} dropped`;
        }
        const id = it?.kind === "youtube" ? it.id || it.src : it?.local ? it.title : it?.share || it?.src;
        const c = P ? codecs(P) : null;
        box.querySelector("dl").innerHTML =
          row("Source", kind) + row("Video", id) + row("Resolution", res ?? (P && !P.native ? "set by the embedded player" : null)) +
          row("Viewport", `${Math.round(sr.width)}×${Math.round(sr.height)} × ${+dpr.toFixed(2)}`) +
          row("Dropped frames", drops) +
          row("Buffer", P && !P.embed ? `${bufferAhead(P).toFixed(2)} s ahead` : null) +
          row("Codecs", c === undefined ? "set by the embedded player" : c || (P?.native ? "not reported by the browser" : null)) +
          row("Speed", P && !P.embed ? `${V.rate}×` : null) +
          row("Time", P && P.d ? `${(P.t || 0).toFixed(2)} / ${P.d.toFixed(2)} s` : null) +
          row("Network", navigator.connection?.downlink ? `${navigator.connection.downlink} Mb/s (${navigator.connection.effectiveType})` : null);
      }
      function set(on) {
        if (on && !box) {
          box = document.createElement("div");
          box.className = "cm-stats";
          box.setAttribute("role", "region");
          box.setAttribute("aria-label", "Stats for nerds");
          box.innerHTML = '<dl></dl><button type="button" aria-label="Close stats">×</button>';
          box.querySelector("button").addEventListener("click", () => set(false));
          for (const ev of ["pointerdown", "pointerup", "click", "dblclick"]) box.addEventListener(ev, (e) => e.stopPropagation());
          V.stage.append(box);
          paint();
          timer = setInterval(paint, 500);
        } else if (!on && box) { clearInterval(timer); box.remove(); box = null; }
      }
      return { get on() { return !!box; }, toggle: () => set(!box), set };
    })();

    const menu = contextMenu({ label: "Video options", items });
    const hasVideo = () => V.stage.dataset.kind !== "none";
    attach(V.stage, menu, { canOpen: hasVideo, keyTarget: (t) => V.stage.contains(t) || t === document.body });

    // ⋮ for touch screens
    const more = document.createElement("button");
    more.type = "button";
    more.className = "cm-more";
    more.setAttribute("aria-label", "More options");
    more.setAttribute("aria-haspopup", "menu");
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="18.5" r="1.9"/></svg>';
    for (const ev of ["pointerdown", "pointerup", "dblclick"]) more.addEventListener(ev, (e) => e.stopPropagation());
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.isOpen) { menu.close(); return; }
      V.closeMenus();
      const r = more.getBoundingClientRect();
      menu.open(r.right, r.bottom + 6, { keyboard: e.detail === 0, from: more });
      V.poke();
    });
    V.stage.append(more);
    window.__videoMenu = { menu, stats, items };
  }

  /* ---------- the song player: links from the cover ---------- */
  const S = window.songPlayer, art = document.querySelector(".art");
  if (S && art) {
    const base = () => location.origin + location.pathname;
    const items = () => {
      const m = S.media, t = m?.currentTime || 0;
      return [
        { label: "Copy song link", icon: "link", run: () => copyText(base(), "Link copied") },
        { label: t >= 1 ? `Copy link at ${fmt(t)}` : "Copy link at current time", icon: "clock", disabled: t < 1, run: () => copyText(`${base()}?t=${Math.floor(t)}`, `Link at ${fmt(t)} copied`) },
        { label: "Copy remix link", icon: "remix", run: () => copyText(S.remixLink ? S.remixLink() : base() + "#remix", S.remixLink ? "Remix link copied" : "Link to the remix desk copied") },
      ];
    };
    const menu = contextMenu({ label: "Song options", items });
    attach(art, menu, { keyTarget: (t) => t === document.body || art.contains(t), touch: true });
    window.__songMenu = menu;
  }
})();
