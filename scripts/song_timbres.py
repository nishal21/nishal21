"""Language-mapped tones for the contribution song.

Each week's dominant language picks a tone family for three layers (808 bass, e-piano keys, pluck arp).
The notes, timing and velocities never change: every family renders the same note list, each family's
layer is EQ'd and loudness-matched to the default layer, and the final layer crossfades between families
at week boundaries (30 ms ramps that end on the downbeat). Weeks with no language keep the default sound.

  gritty (Rust, Go, C, C++): saturated, square-ish 808 that drives harder
  bright (TypeScript, JavaScript): clean, bright pluck tone on keys and arp
  soft (Python): rounded marimba-like mallet on keys and arp
  airy (HTML, CSS): glassy FM bell on keys and arp
"""
import numpy as np
import pyloudnorm as pyln
from scipy import signal

import song_synth as S
from song_synth import SR, adsr, env, hz

FAMILIES = ("gritty", "bright", "soft", "airy")
BLEND = 0.5  # keys keep half the e-piano underneath so the verses keep their warmth


# ---------- tones ----------

_LPS = {}


def _lp(fc):
    if fc not in _LPS:
        _LPS[fc] = S.sos("lowpass", float(min(fc, 18000)))
    return _LPS[fc]


def bright_tone(note, n, vel):
    """Clean bright pluck: saw through a fast-closing filter, no wobble."""
    t = np.arange(n) / SR
    f = float(hz(note))
    x = S.polyblep_saw(f, n) * 0.7 + 0.3 * np.sin(2 * np.pi * f * t)
    cut = 600 + 5200 * env(n, 0.06)
    out = np.zeros(n)
    zi = None
    for i in range(0, n, 512):
        s = _lp(int(cut[i] // 50) * 50)
        if zi is None:
            zi = signal.sosfilt_zi(s) * 0
        out[i:i + 512], zi = signal.sosfilt(s, x[i:i + 512], zi=zi)
    return vel * out * env(n, 0.45) * adsr(n, 0.002, 0.05, 1.0, 0.03)


def mallet_tone(note, n, vel):
    """Marimba-like: fundamental plus the bar's 4x and ~10x partials, which die away fast."""
    t = np.arange(n) / SR
    f = float(hz(note))
    x = (np.sin(2 * np.pi * f * t) * env(n, 0.55) + 0.32 * np.sin(2 * np.pi * 3.93 * f * t) * env(n, 0.07)
         + 0.08 * np.sin(2 * np.pi * 9.2 * f * t) * env(n, 0.025))
    return vel * x * adsr(n, 0.002, 0.05, 1.0, 0.04)


def glass_tone(note, n, vel):
    """Airy glass bell: FM with an inharmonic ratio, soft attack, long shimmer."""
    t = np.arange(n) / SR
    f = float(hz(note))
    mod = np.sin(2 * np.pi * 3.5 * f * t) * (1.6 * env(n, 0.35) + 0.15)
    x = np.sin(2 * np.pi * f * t + mod) * env(n, 1.1) + 0.2 * np.sin(2 * np.pi * 2.76 * f * t) * env(n, 0.5)
    return vel * x * adsr(n, 0.006, 0.05, 1.0, 0.05)


TONE = {"bright": bright_tone, "soft": mallet_tone, "airy": glass_tone}


def gritty_bass(notes, starts, durs, n_total):
    """Same 808 line, driven into a square-ish shape and opened up so it growls."""
    x = S.bass808(notes, starts, durs, n_total, glide=0.07, drive=7.0, lp=1800)
    return x + 0.12 * np.sign(x) * (np.abs(x) > 0.05) * np.abs(x) ** 0.5


# ---------- matching ----------

_EDGES = (250, 2500)  # three broad bands: lows, mids, highs


def _band_levels(x):
    """Power in the three bands, from a Welch spectrum of the mono signal (cheap even for the full song)."""
    f, p = signal.welch(x.mean(0) if x.ndim == 2 else x, SR, nperseg=4096)
    lo, hi = _EDGES
    return np.array([p[f < lo].sum(), p[(f >= lo) & (f < hi)].sum(), p[f >= hi].sum()]) + 1e-20


def eq_filter(alt, ref, amount=0.6):
    """A linear-phase FIR that moves alt's three band levels part of the way to ref's (so the tone keeps
    its character but sits in the same space)."""
    g = np.clip((_band_levels(ref) / _band_levels(alt)) ** (amount / 2), 0.25, 4.0)
    lo, hi = _EDGES
    freqs = [0, lo * 0.7, lo * 1.4, hi * 0.7, hi * 1.4, SR / 2]
    gains = [g[0], g[0], g[1], g[1], g[2], g[2]]
    return signal.firwin2(511, freqs, gains, fs=SR)


_METER = pyln.Meter(SR)


def loudness(x):
    v = _METER.integrated_loudness(x.T if x.ndim == 2 else x)
    return v if np.isfinite(v) else None


def gain_to(x, target):
    """Scale x to the target integrated loudness (LUFS)."""
    lx = loudness(x)
    return x if lx is None or target is None else x * 10 ** ((target - lx) / 20)


# ---------- weekly crossfade ----------

def weights(fams, bar, n, ramp=0.03):
    """{family: gain curve}; gains sum to 1 everywhere, each change is a 30 ms ramp ending on the downbeat."""
    idx = np.zeros(n, dtype=int)
    keys = ["default"] + list(FAMILIES)
    for b, f in enumerate(fams):
        a = int(b * bar * SR)
        idx[a:] = keys.index(f or "default")
    k = int(ramp * SR)
    win = np.hanning(k + 2)[1:-1]
    win /= win.sum()
    out = {}
    for i, key in enumerate(keys):
        m = (idx == i).astype(float)
        if not m.any():
            continue
        c = np.convolve(m, win, mode="full")[:n + k]
        out[key] = c[k // 2: k // 2 + n]
        # shift so the ramp ends at the boundary instead of straddling it
        out[key] = np.r_[out[key][k // 2:], np.full(k // 2, out[key][-1])]
    return out


def apply(inst, events, fams, bar, n):
    """Replace inst['keys'], inst['pluck'] and inst['bass'] with the weekly mix of tone families."""
    used = {f for f in fams if f}
    if not used:
        return inst
    w = weights(fams, bar, n)

    def render_notes(evs, tone, fir=None):
        # tones are linear in velocity, so each (note, length) is rendered once and scaled;
        # the EQ is applied to those short renders instead of the whole layer
        cache, buf = {}, np.zeros((2, n))
        for note, t, nn, vel, p in evs:
            if (note, nn) not in cache:
                y = tone(note, nn, 1.0)
                cache[(note, nn)] = signal.oaconvolve(y, fir)[255:255 + nn] if fir is not None else y
            S.add(buf, S.pan(cache[(note, nn)] * vel, p), t)
        return buf

    for layer in ("keys", "pluck"):
        ref = inst[layer]
        if not events[layer] or not any(f in TONE and f in w for f in used):
            continue
        target = loudness(ref)
        mix = ref * w["default"] if "default" in w else np.zeros_like(ref)
        for f in used:
            if f not in w:
                continue
            if f in TONE:
                raw = render_notes(events[layer], TONE[f])
                alt = gain_to(render_notes(events[layer], TONE[f], eq_filter(raw, ref)), target)
                if layer == "keys":
                    alt = gain_to(BLEND * ref + (1 - BLEND) * alt, target)
            else:
                alt = ref
            mix = mix + alt * w[f]
        inst[layer] = mix
    if "gritty" in used and events["bass"]:
        ref = inst["bass"]
        nb, tb, db, gain = events["bass"]
        g = gritty_bass(nb, tb, db, n) * gain
        g = signal.oaconvolve(g, eq_filter(g, ref[0]))[255:255 + n]
        alt = gain_to(np.stack([g, g]), loudness(ref))
        inst["bass"] = ref * (1 - w["gritty"]) + alt * w["gritty"]
    return inst
