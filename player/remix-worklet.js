// Remix playback, on the audio thread. Holds the decoded stems, mixes them with the fader gains and
// plays the result at any tempo from 70% to 140%:
//   keep pitch off: varispeed, read faster or slower like a turntable (pitch moves with tempo)
//   keep pitch on:  WSOLA time-stretch of the mix (grains of ~46 ms laid back at the original speed,
//                   each one nudged to where its waveform lines up best with the last), so the key stays
// Position is counted in source samples, so the page always knows which bar and lyric is playing.
"use strict";

const N = 2048, HS = N / 2, DELTA = 512;
const WIN = new Float32Array(N);
for (let k = 0; k < N; k++) WIN[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);

class RemixPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stems = new Map();   // name -> { L, R, g, target, sq }
    this.fading = [];         // replaced stems fading out: { L, R, g, step }
    this.length = 0;
    this.pos = 0;             // source samples
    this.rate = 1;
    this.keep = true;
    this.playing = false;
    this.ended = false;
    this.fade = 1;            // de-click envelope around seeks and mode changes
    this.fadeTo = 1;
    this.pending = null;      // change to apply once faded out
    this.blocks = 0;
    this.resetStretch();
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  resetStretch() {
    this.acc = [new Float32Array(N), new Float32Array(N)];
    this.q = [new Float32Array(HS * 4), new Float32Array(HS * 4)];
    this.qn = 0;              // samples waiting in q
    this.qpos = this.pos;     // source position that lines up with acc[0]
    this.ref = null;          // mono tail of the last grain, for the similarity search
    this.primed = false;
  }

  onMessage(m) {
    switch (m.type) {
      case "stem": {
        const old = this.stems.get(m.name);
        if (old && this.playing) this.fading.push({ L: old.L, R: old.R, g: old.g, step: old.g / 2048 });
        this.stems.set(m.name, { L: m.L, R: m.R || m.L, g: old ? (this.playing ? 0 : old.target) : (m.gain ?? 1), target: old ? old.target : (m.gain ?? 1), sq: 0 });
        this.length = Math.max(this.length, m.L.length);
        if (m.ack) this.port.postMessage({ type: "ack", id: m.ack });
        break;
      }
      case "gains":
        for (const [k, v] of Object.entries(m.gains)) { const s = this.stems.get(k); if (s) s.target = v; }
        if (m.now) for (const s of this.stems.values()) s.g = s.target;
        break;
      case "play":
        if (m.pos != null) { this.pos = Math.round(m.pos); this.resetStretch(); }
        this.playing = true; this.ended = false;
        this.fade = 0; this.fadeTo = 1;
        break;
      case "pause":
        if (this.playing) { this.pending = () => { this.playing = false; }; this.fadeTo = 0; }
        break;
      case "seek":
        this.change(() => { this.pos = Math.max(0, Math.round(m.pos)); this.resetStretch(); this.ended = false; });
        break;
      case "rate": {
        const was = this.stretching(this.rate, this.keep), will = this.stretching(m.rate, m.keep);
        if (was !== will) {
          this.change(() => { this.rate = m.rate; this.keep = m.keep; this.pos = Math.round(this.pos); this.resetStretch(); });
        } else {
          this.rate = m.rate; this.keep = m.keep; // the stretch picks the new speed up at its next grain; varispeed at once
        }
        break;
      }
      case "ping":
        this.port.postMessage({ type: "ack", id: m.id });
        break;
    }
  }

  stretching(rate, keep) { return keep && Math.abs(rate - 1) > 1e-6; }

  // apply a jump with a short fade out and in, so it doesn't click
  change(fn) {
    if (!this.playing) { fn(); return; }
    this.pending = fn;
    this.fadeTo = 0;
  }

  // Hermite read of one channel at a fractional position
  static read(x, p) {
    const i = Math.floor(p), f = p - i;
    const xm = x[i - 1] ?? 0, x0 = x[i] ?? 0, x1 = x[i + 1] ?? 0, x2 = x[i + 2] ?? 0;
    if (f === 0) return x0;
    const c = (x1 - xm) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, b = w + a;
    return (((a * f) - b) * f + c) * f + x0;
  }

  // mono mix (gains applied) of src samples [a, a + n) into out
  mono(a, n, out) {
    out.fill(0, 0, n);
    for (const s of this.stems.values()) {
      if (s.target === 0 && s.g === 0) continue;
      const g = s.target * 0.5, L = s.L, R = s.R;
      for (let k = 0; k < n; k++) { const i = a + k; if (i >= 0 && i < L.length) out[k] += g * (L[i] + R[i]); }
    }
  }

  grain() {
    const r = this.rate;
    const nominal = Math.round(this.qpos + (N / 2) * (r - 1));
    let start = nominal;
    if (this.ref) {
      // search +-DELTA around the nominal start for the best match with the last grain's continuation
      const seg = this.seg || (this.seg = new Float32Array(2 * DELTA + HS));
      this.mono(nominal - DELTA, 2 * DELTA + HS, seg);
      const ref = this.ref;
      let best = -Infinity, bd = 0;
      for (let d = 0; d <= 2 * DELTA; d += 2) {
        let c = 0;
        for (let k = 0; k < HS; k += 4) c += ref[k] * seg[d + k];
        if (c > best) { best = c; bd = d; }
      }
      for (let d = Math.max(0, bd - 2); d <= Math.min(2 * DELTA, bd + 2); d++) {
        let c = 0;
        for (let k = 0; k < HS; k++) c += ref[k] * seg[d + k];
        if (c > best) { best = c; bd = d; }
      }
      start = nominal - DELTA + bd;
    }
    const [aL, aR] = this.acc;
    const ref = this.ref || (this.ref = new Float32Array(HS));
    ref.fill(0);
    for (const s of this.stems.values()) {
      s.g = s.target; // gains move at grain rate; the window overlap smooths the step
      if (s.g === 0) continue;
      const g = s.g, L = s.L, R = s.R;
      let sq = 0;
      for (let k = 0; k < N; k++) {
        const i = start + k;
        if (i < 0 || i >= L.length) continue;
        const l = g * L[i], rr = g * R[i];
        aL[k] += WIN[k] * l; aR[k] += WIN[k] * rr;
        if (k >= HS) { ref[k - HS] += 0.5 * (l + rr); sq += l * l + rr * rr; }
      }
      s.sq = 0.5 * s.sq + 0.5 * (sq / HS);
    }
    this.qpos += HS * r;
  }

  // emit the finished half of the accumulator into the queue
  shift() {
    const [aL, aR] = this.acc, [qL, qR] = this.q;
    qL.set(aL.subarray(0, HS), this.qn); qR.set(aR.subarray(0, HS), this.qn);
    this.qn += HS;
    aL.copyWithin(0, HS); aR.copyWithin(0, HS);
    aL.fill(0, HS); aR.fill(0, HS);
  }

  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    if (!this.playing || !this.stems.size) {
      L.fill(0); R.fill(0);
      this.tick(false);
      return true;
    }
    const stretch = this.stretching(this.rate, this.keep);
    if (stretch) {
      if (!this.primed) {
        // one grain before the start, its fade-in half thrown away, so the first sample out is at full level
        this.qpos = this.pos - HS * this.rate;
        this.grain();      // leaves qpos at pos
        this.shift();
        this.qn = 0;
        this.primed = true;
      }
      while (this.qn < n) { this.grain(); this.shift(); }
      const [qL, qR] = this.q;
      L.set(qL.subarray(0, n)); R.set(qR.subarray(0, n));
      qL.copyWithin(0, n, this.qn); qR.copyWithin(0, n, this.qn);
      this.qn -= n;
      this.pos += n * this.rate;
      for (const s of this.stems.values()) if (s.g === 0) s.sq *= 0.8;
    } else {
      L.fill(0); R.fill(0);
      const r = this.rate, p0 = this.pos;
      for (const s of this.stems.values()) {
        const g0 = s.g, g1 = s.target;
        s.g = g1;
        if (g0 === 0 && g1 === 0) { s.sq *= 0.8; continue; }
        const SL = s.L, SR = s.R;
        let sq = 0;
        for (let k = 0; k < n; k++) {
          const g = g0 + ((g1 - g0) * (k + 1)) / n;
          const p = p0 + k * r;
          const l = g * RemixPlayer.read(SL, p);
          const rr = g * RemixPlayer.read(SR, p);
          L[k] += l; R[k] += rr; sq += l * l + rr * rr;
        }
        s.sq = 0.8 * s.sq + 0.2 * (sq / n);
      }
      this.pos += n * r;
    }
    // stems being swapped out (drum kits) fade under the new ones
    if (this.fading.length) {
      const p0 = this.pos - n * this.rate;
      for (const f of this.fading) {
        for (let k = 0; k < n && f.g > 0; k++) {
          const p = Math.round(p0 + k * this.rate);
          L[k] += f.g * (f.L[p] ?? 0); R[k] += f.g * (f.R[p] ?? 0);
          f.g = Math.max(0, f.g - f.step);
        }
      }
      this.fading = this.fading.filter((f) => f.g > 0);
    }
    // de-click
    if (this.fade !== 1 || this.fadeTo !== 1) {
      const step = 1 / 96;
      for (let k = 0; k < n; k++) {
        this.fade += Math.sign(this.fadeTo - this.fade) * Math.min(step, Math.abs(this.fadeTo - this.fade));
        L[k] *= this.fade; R[k] *= this.fade;
      }
      if (this.fade === 0 && this.pending) { this.pending(); this.pending = null; this.fadeTo = 1; }
    }
    if (this.pos >= this.length) {
      this.playing = false;
      this.pos = this.length;
      this.port.postMessage({ type: "ended" });
    }
    this.tick(true);
    return true;
  }

  tick(playing) {
    if (++this.blocks % 4 && playing) return;
    if (!playing && this.blocks % 16) return;
    const levels = {};
    for (const [k, s] of this.stems) levels[k] = s.sq;
    this.port.postMessage({ type: "tick", pos: this.pos, time: currentTime, playing: this.playing, levels });
  }
}

registerProcessor("remix-player", RemixPlayer);
