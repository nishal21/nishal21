"""Big weeks as drops: one-shot accents on the downbeat of a week's bar for releases, big merged pull
requests, new repos and the single biggest contribution day (events come from song_data.week_events).

  release  crash and reverse swell into an impact
  pr       short filter-sweep riser into a sub drop
  repo     bright two-note glass chime
  peak     stutter fill on the last beat of the bar

Rules: at most one accent per bar (the most important event that fits: release, pr, peak, repo), never
while a lyric is being sung or rapped (an accent whose loud part would overlap a line is skipped), never in
the bar right after another accent, and every accent is gain-staged under the existing section impacts.
"""
import numpy as np
from scipy import signal

import song_synth as S
from song_synth import SR, env
from song_timbres import glass_tone

LEVEL = {"release": 0.42, "pr": 0.42, "repo": 0.16, "peak": 0.3}


def _noise(rng, n):
    return rng.uniform(-1, 1, n)


def release(rng, bar):
    pre = int(1.0 * SR)
    swell = signal.sosfilt(S.sos("highpass", 4000), _noise(rng, pre)) * env(pre, 0.35)[::-1]
    n = int(1.8 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-t * 8)) / SR) * env(n, 0.45)
    crash = signal.sosfilt(S.sos("highpass", 5000), _noise(rng, n)) * env(n, 0.9) * 0.45
    return np.r_[swell * 0.6, 0.8 * boom + crash], pre / SR


def pr(rng, bar):
    pre = int(bar * 0.5 * SR)
    x = _noise(rng, pre)
    out = np.zeros(pre)
    for i in range(32):
        a, b = i * pre // 32, (i + 1) * pre // 32
        fc = 400 * (25 ** (i / 32))
        out[a:b] = signal.sosfilt(S.sos("bandpass", [fc * 0.7, min(fc * 1.4, 19000)]), x[a:b])
    out *= np.linspace(0, 1, pre) ** 2
    n = int(1.0 * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(30 + 32 * np.exp(-t * 5)) / SR) * env(n, 0.5)
    sub *= np.minimum(1, np.arange(n) / (0.004 * SR))
    return np.r_[out * 0.5, sub], pre / SR


def chime(chord):
    a, b = chord[0] + 24, chord[2] + 24
    n = int(1.6 * SR)
    x = glass_tone(a, n, 1.0)
    y = np.zeros(n)
    k = int(0.09 * SR)
    y[k:] = glass_tone(b, n - k, 0.8)
    return signal.sosfilt(S.sos("highpass", 500), x + y), 0.0


def stutter(rng, beat):
    """Eight 32nd-note snare hits over the last beat, getting louder."""
    n = int(beat * SR) + int(0.1 * SR)
    out = np.zeros(n)
    for i in range(8):
        h = S.snare(0.35 + 0.08 * i)
        a = int(i * beat / 8 * SR)
        m = min(len(h), n - a)
        out[a:a + m] += h[:m]
    return out, 0.0


def _window(kind, t0, bar, beat):
    """The span where an accent is loud."""
    return {"release": (t0 - 1.0, t0 + 0.9), "pr": (t0 - bar * 0.5, t0 + 0.6),
            "repo": (t0, t0 + 0.8), "peak": (t0 + 3 * beat, t0 + bar)}[kind]


def render(week_events, timeline, bar, beat, n, chord_for_bar):
    """Returns (stereo accent stem, [(bar, event) placed])."""
    rng = np.random.default_rng(2112)
    lines = [(l["start"] - 0.05, l["end"] + 0.15) for l in timeline]

    def free(a, b):
        return all(b <= s or a >= e for s, e in lines)

    out = np.zeros((2, n))
    placed, last = [], -9
    for b, evs in enumerate(week_events):
        t0 = b * bar
        for ev in evs:
            kind = ev["type"]
            if last == b - 1:  # leave a bar of air after every accent
                break
            a, e = _window(kind, t0, bar, beat)
            if not free(a, e):
                continue
            if kind == "release":
                x, pre = release(rng, bar)
                at = t0 - pre
            elif kind == "pr":
                x, pre = pr(rng, bar)
                at = t0 - pre
            elif kind == "repo":
                x, _ = chime(chord_for_bar(b))
                at = t0
            else:
                x, _ = stutter(rng, beat)
                at = t0 + 3 * beat
            S.add(out, S.pan(x * LEVEL[kind], 0), at)
            placed.append((b, ev))
            last = b
            break
    return out, placed
