/* Long press on the left of the picture rewinds at 2× instead (stepping the time back, since browsers
   don't play backwards); the middle and right play forward at 2×.
   Hold for 2×, like YouTube: press and hold the video (mouse or touch) or hold Space, and it plays at 2×
   until you let go, then goes back to the speed it had. Sliding sideways while holding picks 1.5× to 3×.
   A quick tap of Space still plays and pauses; a hold never also pauses, opens a menu or selects text. */
(() => {
  "use strict";
  const V = window.videoPage;
  if (!V) return;
  const HOLD_MS = 380, MOVE_CANCEL = 12, MIN = 1.5, MAX = 3, STEP = 0.25;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const { stage, shield } = V;

  const pill = document.createElement("div");
  pill.className = "hold-pill";
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  pill.innerHTML = '<span class="hp-rate">2×</span><span class="hp-arrows" aria-hidden="true"><span>▸</span><span>▸</span></span>';
  stage.append(pill);

  let holding = false, prevRate = 1, rate = 2, timer = 0, ptr = null, spaceDown = false, spaceUsed = false;
  let rewinding = false, rewRaf = 0, rewLast = 0, rewT = 0, rewSeekAt = 0, rewWasPlaying = false;
  const side = (p) => { if (!p) return 0; const r = stage.getBoundingClientRect(); const x = (p.x - r.left) / r.width; return x < 0.36 ? -1 : x > 0.64 ? 1 : 0; };
  function rewStep(now) {
    if (!rewinding) return;
    const P = V.adapter;
    const dt = Math.min(0.1, (now - rewLast) / 1000);
    rewLast = now;
    rewT = Math.max(0, rewT - dt * rate);
    // video files can take a seek every frame; embedded players get one every quarter second
    if (P.native || now - rewSeekAt > 250) { rewSeekAt = now; P.seek(rewT, P.native); }
    if (rewT <= 0) { end(); return; }
    rewRaf = requestAnimationFrame(rewStep);
  }

  // the fastest this source allows: video files go to 3×, embedded players only to their own top speed (2× on YouTube)
  const top = () => (V.adapter?.native ? MAX : Math.max(...V.rates()));
  const canHold = () => { const P = V.adapter; return !!P && !P.embed && !P.paused && !stage.classList.contains("ended") && top() >= MIN; };
  function setHoldRate(r) {
    const max = top(), allowed = V.rates().filter((x) => x >= MIN);
    r = clamp(r, MIN, Math.min(MAX, max));
    if (!V.adapter?.native && allowed.length) r = allowed.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a)); // only speeds the source offers
    if (r === rate && holding) return;
    rate = r;
    V.adapter?.setRate(r);
    pill.querySelector(".hp-rate").textContent = `${+r.toFixed(2)}×`;
  }
  function begin() {
    timer = 0;
    if (ptr && side(ptr) < 0 && V.adapter && !V.adapter.embed && V.adapter.d > 0) {
      // rewind: pause, then walk the time back at 2× until the press ends
      const P = V.adapter;
      holding = true; rewinding = true; rate = 2;
      rewWasPlaying = !P.paused;
      if (rewWasPlaying) P.pause();
      rewT = P.t; rewLast = performance.now(); rewSeekAt = 0;
      stage.classList.add("holding");
      pill.classList.add("show", "rew");
      pill.querySelector(".hp-rate").textContent = "−2×";
      if (ptr?.type === "touch") navigator.vibrate?.(8);
      rewRaf = requestAnimationFrame(rewStep);
      return;
    }
    if (!canHold()) return;
    holding = true;
    prevRate = V.rate;
    stage.classList.add("holding");
    rate = 0;
    setHoldRate(2);
    pill.classList.add("show");
    getSelection?.()?.removeAllRanges?.();
    if (ptr?.type === "touch") navigator.vibrate?.(8);
  }
  function end() {
    clearTimeout(timer);
    timer = 0;
    if (!holding) return false;
    holding = false;
    stage.classList.remove("holding");
    pill.classList.remove("show");
    if (rewinding) {
      rewinding = false;
      cancelAnimationFrame(rewRaf);
      pill.classList.remove("rew");
      V.seekTo(rewT);
      if (rewWasPlaying) V.adapter?.play();
      return true;
    }
    V.setRate(prevRate);
    return true;
  }

  /* press and hold on the picture */
  shield.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, moved: false };
    clearTimeout(timer);
    const P = V.adapter;
    if (canHold() || (side(ptr) < 0 && P && !P.embed && P.d > 0)) timer = setTimeout(begin, HOLD_MS);
  });
  shield.addEventListener("pointermove", (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!holding) {
      if (Math.hypot(dx, dy) > MOVE_CANCEL) { clearTimeout(timer); timer = 0; }
      return;
    }
    if (rewinding) return;
    // a quarter of the player's width covers the whole 1.5×–3× range on either side of 2×
    const w = Math.max(240, stage.getBoundingClientRect().width);
    const r = 2 + (dx / (w * 0.25)) * (dx < 0 ? 0.5 : 1);
    setHoldRate(Math.round(r / STEP) * STEP);
  });
  shield.addEventListener("pointerdown", (e) => { if (holding || timer) try { shield.setPointerCapture(e.pointerId); } catch {} });
  // once the hold has started, sliding sideways must not scroll the page (that would cancel the pointer)
  shield.addEventListener("touchmove", (e) => { if (holding) e.preventDefault(); }, { passive: false });
  // capture on the stage runs before the page's own tap handling on the shield, so a hold isn't also a tap
  const release = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    ptr = null;
    if (end()) { e.stopPropagation(); e.preventDefault?.(); }
  };
  stage.addEventListener("pointerup", release, true);
  stage.addEventListener("pointercancel", release, true);
  shield.addEventListener("lostpointercapture", (e) => { if (holding && ptr && e.pointerId === ptr.id) { ptr = null; end(); } });
  // a long press on touch is ours, not the browser's menu or text selection
  stage.addEventListener("contextmenu", (e) => { if (holding || (ptr && ptr.type !== "mouse")) e.preventDefault(); }, true);
  stage.addEventListener("selectstart", (e) => { if (ptr) e.preventDefault(); });
  stage.addEventListener("dblclick", (e) => { if (holding) { e.stopPropagation(); e.preventDefault(); } }, true);

  /* hold Space: a tap plays or pauses as before, a hold is 2× */
  const typing = (t) => t.closest?.("input:not([type=range]), textarea, select, [contenteditable], dialog, button, a, summary, [role=menu], [role=menuitem], [role=slider]");
  addEventListener("keydown", (e) => {
    if (e.key !== " " || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    const P = V.adapter;
    if (!P || P.embed) return;
    e.preventDefault();
    e.stopPropagation(); // video.js would toggle on every key repeat
    if (e.repeat) return;
    spaceDown = true;
    spaceUsed = false;
    if (P.paused || stage.classList.contains("ended")) {
      // paused: play right away, and a held key is just a held key
      spaceUsed = true;
      V.toggle(); V.bezel(V.adapter.paused ? "#i-pause" : "#i-play"); V.poke();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(begin, HOLD_MS);
  }, true);
  addEventListener("keyup", (e) => {
    if (e.key !== " " || !spaceDown) return;
    spaceDown = false;
    e.preventDefault();
    e.stopPropagation();
    if (end() || spaceUsed) return;
    clearTimeout(timer);
    V.toggle(); V.bezel(V.adapter?.paused ? "#i-pause" : "#i-play"); V.poke();
  }, true);
  addEventListener("blur", () => { spaceDown = false; ptr = null; end(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { spaceDown = false; ptr = null; end(); } });

  window.__hold = { get holding() { return holding; }, get rate() { return rate; }, get rewinding() { return rewinding; } };
})();
