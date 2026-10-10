"""Instruments and mix tools for the contribution song. numpy + scipy only."""
import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d, minimum_filter1d

SR = 44100
_rng = np.random.default_rng(140)


def hz(midi):
    return 440.0 * 2 ** ((np.asarray(midi, dtype=float) - 69) / 12)


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def env(n, decay):
    return np.exp(-np.arange(n) / (SR * decay))


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.05):
    e = np.full(n, s, dtype=float)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    e[na:na + nd] = np.linspace(1, s, nd, endpoint=False)
    nr = min(nr, n)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def add(buf, x, start):
    """Mix x into buf (1-D or 2-D [ch, n]) at time `start` seconds."""
    s = int(round(start * SR))
    if s < 0:
        x = x[..., -s:]
        s = 0
    n = buf.shape[-1]
    if s >= n:
        return
    e = min(n, s + x.shape[-1])
    buf[..., s:e] += x[..., :e - s]


def pan(x, p):
    """p in [-1, 1]; constant-power."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def noise(n):
    return _rng.uniform(-1, 1, n)


def polyblep_saw(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    # polyBLEP: smooth the discontinuity at each reset to cut aliasing
    t = ph
    blep = np.zeros(n)
    a = t < dt
    tt = t[a] / dt[a]
    blep[a] = tt + tt - tt * tt - 1
    b = t > 1 - dt
    tt = (t[b] - 1) / dt[b]
    blep[b] = tt * tt + tt + tt + 1
    return y - blep


# ---------- drums ----------

def kick(vel=1.0):
    n = int(SR * 0.42)
    t = np.arange(n) / SR
    f = 48 + 120 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.13)
    click = signal.sosfilt(sos("highpass", 2500), noise(n)) * env(n, 0.004) * 0.5
    return vel * np.tanh(1.8 * (body + click)) * 0.9


def snare(vel=1.0):
    n = int(SR * 0.3)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (190 + 40 * np.exp(-t * 60)) * t) * env(n, 0.05)
    nz = signal.sosfilt(sos("bandpass", [1800, 9000]), noise(n)) * env(n, 0.09)
    return vel * (0.55 * body + 0.9 * nz)


def clap(vel=1.0):
    n = int(SR * 0.35)
    x = signal.sosfilt(sos("bandpass", [1000, 6000]), noise(n))
    e = np.zeros(n)
    for off in (0, 0.009, 0.019, 0.028):
        s0 = int(off * SR)
        e[s0:] += env(n - s0, 0.006 if off < 0.028 else 0.1)
    return vel * 0.8 * x * e


def hat(vel=1.0, open_=False):
    n = int(SR * (0.32 if open_ else 0.06))
    x = signal.sosfilt(sos("highpass", 7500), noise(n))
    return vel * 0.45 * x * env(n, 0.09 if open_ else 0.014)


def rim(vel=1.0):
    n = int(SR * 0.06)
    t = np.arange(n) / SR
    return vel * 0.5 * (np.sin(2 * np.pi * 1700 * t) + 0.5 * signal.sosfilt(sos("bandpass", [2000, 5000]), noise(n))) * env(n, 0.01)


def impact(seconds=2.0):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-t * 8)) / SR) * env(n, 0.5)
    crash = signal.sosfilt(sos("highpass", 3000), noise(n)) * env(n, 0.6) * 0.35
    return 0.8 * boom + crash


def riser(seconds):
    n = int(SR * seconds)
    t = np.linspace(0, 1, n)
    out = np.zeros(n)
    x = noise(n)
    # sweep a band-pass upward in blocks
    blocks = 64
    for i in range(blocks):
        a, b = i * n // blocks, (i + 1) * n // blocks
        fc = 300 * (40 ** (i / blocks))
        out[a:b] = signal.sosfilt(sos("bandpass", [fc * 0.7, min(fc * 1.4, 20000)]), x[a:b])
    tone = polyblep_saw(110 * 2 ** (3 * t), n) * 0.15
    return (out * 0.6 + tone) * t ** 2


def reverse_cymbal(seconds=1.2):
    n = int(SR * seconds)
    x = signal.sosfilt(sos("highpass", 4000), noise(n)) * env(n, 0.35)
    return x[::-1] * 0.5


def crackle(n, density=6.0):
    """Quiet vinyl crackle for the lo-fi sections."""
    out = signal.sosfilt(sos("bandpass", [800, 6000]), noise(n)) * 0.02
    clicks = (_rng.random(n) < density / SR) * _rng.uniform(0.2, 1.0, n)
    out += signal.sosfilt(sos("highpass", 1500), clicks) * 0.4
    return out


# ---------- tonal ----------

def supersaw(notes, n, voices=7, detune=0.18, cutoff=5000, att=0.01, rel=0.15, spread=0.8):
    """Stereo detuned saw stack for chords (future-bass style)."""
    out = np.zeros((2, n))
    for note in notes:
        f = float(hz(note))
        for v in range(voices):
            d = (v - (voices - 1) / 2) / ((voices - 1) / 2) if voices > 1 else 0
            x = polyblep_saw(f * 2 ** (d * detune / 12), n, phase0=_rng.random())
            out += pan(x, d * spread) / voices
    out /= max(1, len(notes))
    out = signal.sosfilt(sos("lowpass", cutoff), out, axis=1)
    return out * adsr(n, att, 0.2, 0.85, rel)


def warm_pad(notes, n, cutoff=1200):
    return supersaw(notes, n, voices=5, detune=0.12, cutoff=cutoff, att=0.45, rel=0.4, spread=0.9) * 0.9


def epiano(note, n, vel=0.7):
    """FM electric piano, a bit of lo-fi wobble."""
    t = np.arange(n) / SR
    f = float(hz(note)) * (1 + 0.002 * np.sin(2 * np.pi * 0.7 * t))
    mod = np.sin(2 * np.pi * f * t) * (1.8 * env(n, 0.25) + 0.2)
    x = np.sin(2 * np.pi * f * t + mod) * env(n, 0.9) + 0.25 * np.sin(4 * np.pi * f * t) * env(n, 0.2)
    return vel * x * adsr(n, 0.003, 0.05, 1.0, 0.05)


def pluck(note, n, vel=0.7, bright=3000):
    t = np.arange(n) / SR
    f = float(hz(note))
    x = 0.6 * polyblep_saw(f, n) + 0.4 * np.sign(np.sin(2 * np.pi * f * t)) * 0.6
    cut = 300 + bright * env(n, 0.08)
    # time-varying low-pass in blocks
    out = np.zeros(n)
    blk = 512
    zi = None
    for i in range(0, n, blk):
        s = sos("lowpass", float(min(cut[i], 18000)))
        if zi is None:
            zi = signal.sosfilt_zi(s) * 0
        out[i:i + blk], zi = signal.sosfilt(s, x[i:i + blk], zi=zi)
    return vel * out * env(n, 0.35) * adsr(n, 0.002, 0.05, 1.0, 0.03)


def lead(notes, n_total, starts, durs, vel=0.6, vibrato=0.25):
    """Monophonic saw lead with glide between notes. notes/starts/durs in MIDI/seconds."""
    if not len(notes):
        return np.zeros(n_total)
    f = np.zeros(n_total)
    amp = np.zeros(n_total)
    for i, (note, st, du) in enumerate(zip(notes, starts, durs)):
        a, b = int(st * SR), min(n_total, int((st + du) * SR))
        if a >= n_total:
            break
        f[a:b] = float(hz(note))
        amp[a:b] = adsr(b - a, 0.01, 0.1, 0.8, 0.06)
    # glide: fill gaps with previous freq, then smooth frequency
    last = float(hz(notes[0]))
    for i in range(n_total):
        if f[i] == 0:
            f[i] = last
        else:
            last = f[i]
    k = int(SR * 0.03)
    f = np.convolve(f, np.ones(k) / k, mode="same")
    t = np.arange(n_total) / SR
    f *= 1 + 0.004 * vibrato * np.sin(2 * np.pi * 5.2 * t)
    x = 0.7 * polyblep_saw(f, n_total) + 0.3 * polyblep_saw(f * 1.004, n_total)
    x = signal.sosfilt(sos("lowpass", 3200), x)
    return vel * x * amp


def bass808(notes, starts, durs, n_total, glide=0.06, drive=2.5, lp=900):
    """808 sub with portamento into each note."""
    f = np.zeros(n_total)
    amp = np.zeros(n_total)
    prev = None
    for note, st, du in zip(notes, starts, durs):
        a, b = int(st * SR), min(n_total, int((st + du) * SR))
        if a >= n_total:
            break
        target = float(hz(note))
        seg = np.full(b - a, target)
        if prev is not None and glide > 0:
            g = min(b - a, int(glide * SR))
            seg[:g] = prev * (target / prev) ** np.linspace(0, 1, g)
        f[a:b] = seg
        amp[a:b] = np.exp(-np.arange(b - a) / (SR * 1.2)) * np.minimum(1, (b - a - np.arange(b - a)) / (SR * 0.015))
        prev = target
    f[f == 0] = 40
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = np.tanh(drive * x) / np.tanh(drive)
    x = signal.sosfilt(sos("lowpass", lp), x)
    return x * amp


# ---------- mix tools ----------

def compress(x, thr_db=-18, ratio=3.0, attack=0.005, release=0.12, makeup_db=0.0):
    """Feed-forward RMS compressor on mono or stereo (linked)."""
    mono = np.abs(x).max(axis=0) if x.ndim == 2 else np.abs(x)
    k = max(1, int(SR * attack))
    lvl = np.sqrt(np.convolve(mono ** 2, np.ones(k) / k, mode="same") + 1e-12)
    db = 20 * np.log10(lvl + 1e-12)
    over = np.maximum(0, db - thr_db)
    gr = over * (1 - 1 / ratio)
    # release smoothing: one-pole on gain reduction
    a = np.exp(-1 / (SR * release))
    gr = signal.lfilter([1 - a], [1, -a], gr)
    g = 10 ** ((makeup_db - gr) / 20)
    return x * g


def sidechain(n, hits, depth=0.6, release=0.18):
    """Gain curve that dips at each kick time (seconds)."""
    g = np.ones(n)
    r = int(SR * release * 2.5)
    shape = 1 - depth * np.exp(-np.arange(r) / (SR * release))
    for h in hits:
        a = int(h * SR)
        if a >= n:
            continue
        b = min(n, a + r)
        g[a:b] = np.minimum(g[a:b], shape[:b - a])
    return g


def reverb_ir(seconds=2.2, decay=0.55, seed=1, predelay=0.02, damp=5500):
    r = np.random.default_rng(seed)
    n = int(SR * seconds)
    ir = r.uniform(-1, 1, n) * env(n, decay)
    ir = signal.sosfilt(sos("lowpass", damp), ir)
    ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
    return ir / np.sqrt(np.sum(ir ** 2))


def reverb(stereo, seconds=2.2, decay=0.55):
    """Return the wet signal only (stereo in, stereo out)."""
    if stereo.ndim == 1:
        stereo = np.stack([stereo, stereo])
    out = np.zeros_like(stereo)
    for ch, seed in ((0, 1), (1, 2)):
        out[ch] = signal.fftconvolve(stereo[ch], reverb_ir(seconds, decay, seed))[:stereo.shape[1]]
    return signal.sosfilt(sos("highpass", 250), out, axis=1)


def delay(stereo, time, feedback=0.35, repeats=4, pingpong=True):
    out = np.zeros_like(stereo)
    d = int(time * SR)
    g = 1.0
    for k in range(1, repeats + 1):
        g *= feedback
        src = stereo if not pingpong else stereo[::-1] if k % 2 else stereo
        out[:, k * d:] += g * src[:, :stereo.shape[1] - k * d]
    return signal.sosfilt(sos("bandpass", [300, 6000]), out, axis=1)


def true_peak(stereo, os_factor=4):
    up = signal.resample_poly(stereo, os_factor, 1, axis=1)
    return float(np.max(np.abs(up)))


def limit(stereo, ceiling_db=-1.5, lookahead=0.005, release=0.08, os_factor=4):
    """Look-ahead limiter on true (oversampled) peaks."""
    ceiling = 10 ** (ceiling_db / 20)
    up = np.abs(signal.resample_poly(stereo, os_factor, 1, axis=1)).max(axis=0)
    pk = up[: (len(up) // os_factor) * os_factor].reshape(-1, os_factor).max(axis=1)
    pk = np.pad(pk, (0, stereo.shape[1] - len(pk)), mode="edge")
    k = max(1, int(lookahead * SR))
    pk = maximum_filter1d(pk, size=2 * k + 1)
    g = np.minimum(1.0, ceiling / (pk + 1e-12))
    g = minimum_filter1d(g, size=2 * k + 1)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    # slower release
    a = np.exp(-1 / (SR * release))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(0, len(g), 64):  # blockwise is plenty for a gentle release
        blk = g[i:i + 64]
        m = blk.min()
        cur = min(m, cur * a ** 64 + (1 - a ** 64) * 1.0) if m < cur else min(1.0, cur + (1 - a ** 64) * (1 - cur))
        out[i:i + 64] = np.minimum(blk, cur)
    return stereo * out
