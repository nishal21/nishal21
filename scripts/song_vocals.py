"""Vocals for the contribution song.

Verses: rap lines from a Piper TTS voice, fitted to their bars.
Sung parts (Line): each line is one Piper utterance, analysed once with the WORLD vocoder (pyworld).
Voiced stretches are split into syllable nuclei, stretched so each starts on the beat grid and retuned to
a melody note; consonants keep their own timing, pitch and aperiodicity. The whole line is resynthesized
in one pass (no splicing), so there are no joins to click. WORLD keeps the spectral envelope, so formants
stay put while the pitch moves. The harmony reuses the same timing plan at other notes.
Word/chop are only used for short vocal chops in the instrumental hook.
"""
import os
import re
import urllib.request
import warnings

import numpy as np
from scipy import signal

from song_synth import SR, hz, sos

warnings.filterwarnings("ignore", message=".*pkg_resources.*")
import pyworld as pw  # noqa: E402

VOICE_DIR = os.environ.get("PIPER_VOICE_DIR", os.path.expanduser("~/.cache/piper-voices"))
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/"
RAP_VOICE = ("en_US-ryan-high", "en_US/ryan/high/")
SING_VOICE = ("en_US-lessac-high", "en_US/lessac/high/")  # clearest of 4 female voices when retuned
FRAME = 5.0  # ms

from song_lyrics import say_name as _say_name  # noqa: E402

IPA_VOWELS = set("aeiouæɑɒɔəɛɜɪʊʌɐɚɝy")


def load(name_path):
    from piper import PiperVoice
    name, sub = name_path
    path = os.path.join(VOICE_DIR, name + ".onnx")
    if not os.path.exists(path):
        os.makedirs(VOICE_DIR, exist_ok=True)
        for ext in (".onnx", ".onnx.json"):
            urllib.request.urlretrieve(HF + sub + name + ext, os.path.join(VOICE_DIR, name + ext))
    return PiperVoice.load(path)


def say_name(name):
    """Spoken form of a repo name (see song_lyrics.say_name); falls back to the raw name."""
    return _say_name(name) or name


_LP = {}


def up(y, fs, fs_out=SR):
    """Resample a 22.05 kHz voice to the song rate and remove the resampler's images above the voice band."""
    y = signal.resample_poly(y, fs_out, fs)
    key = (fs, fs_out)
    if key not in _LP:
        _LP[key] = signal.butter(10, 0.47 * fs, "lowpass", fs=fs_out, output="sos")
    return signal.sosfiltfilt(_LP[key], y)


def tts(voice, text, speed=1.0, native=False):
    from piper import SynthesisConfig
    cfg = SynthesisConfig(length_scale=speed, noise_scale=0.6, noise_w_scale=0.7)
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64)
    idx = np.where(np.abs(a) > 0.015)[0]
    if len(idx):
        a = a[max(0, idx[0] - 80):idx[-1] + 200]
    return a if native else up(a, voice.config.sample_rate)


# ---------- rap ----------

def rap_line(voice, text, window):
    """Speak a line so it fills ~88% of its window, within natural speed limits."""
    x = tts(voice, text, 0.95)
    scale = float(np.clip(0.88 * window / (len(x) / SR), 0.72, 1.12))
    if abs(scale - 0.95) > 0.03:
        x = tts(voice, text, scale)
    if len(x) / SR > window * 0.98:
        x = x[: int(window * 0.98 * SR)]
        x[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return signal.sosfilt(sos("highpass", 90), x)


# ---------- singing ----------

def syllable_count(word):
    if word.startswith("[["):
        ipa = word.strip("[]")
        return max(1, len(re.findall(r"[aeiouæɑɒɔəɛɜɪʊʌɐɚɝ]+[ːɪʊə]?", ipa)))
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 1
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and not w.endswith(("le", "ee", "ye")) and n > 1:
        n -= 1
    if w.endswith("es") and n > 1 and not w.endswith(("ses", "zes", "ches", "shes", "ges")):
        n -= 1
    return max(1, n)


def split_words(text):
    return re.findall(r"\[\[.*?\]\]|[A-Za-z0-9']+", text)


class Word:
    """A word analysed by WORLD and split into syllables."""

    def __init__(self, voice, word):
        fs = voice.config.sample_rate
        x = tts(voice, word, 1.0, native=True)
        x = np.concatenate([np.zeros(int(0.01 * fs)), x, np.zeros(int(0.02 * fs))])
        f0, t = pw.harvest(x, fs, f0_floor=80, f0_ceil=600, frame_period=FRAME)
        self.fs = fs
        self.sp = pw.cheaptrick(x, f0, t, fs)
        self.ap = pw.d4c(x, f0, t, fs)
        self.voiced = f0 > 0
        self.syl = self._split(syllable_count(word))

    def _split(self, n):
        frames = len(self.voiced)
        energy = np.log(self.sp.sum(axis=1) + 1e-12)
        e = np.convolve(energy, np.ones(5) / 5, mode="same")
        vidx = np.where(self.voiced)[0]
        if len(vidx) == 0 or n == 1:
            return [(0, frames)]
        lo, hi = vidx[0] + 8, vidx[-1] - 8
        cands = [i for i in range(max(lo, 1), min(hi, frames - 1)) if e[i] <= e[i - 1] and e[i] <= e[i + 1]]
        cands.sort(key=lambda i: e[i])
        picks = []
        for c in cands:
            if all(abs(c - p) >= 12 for p in picks):
                picks.append(c)
            if len(picks) == n - 1:
                break
        if len(picks) < n - 1:  # not enough dips: split the voiced span evenly
            picks = list(np.linspace(vidx[0], vidx[-1], n + 1)[1:-1].astype(int))
        b = [0] + sorted(picks) + [frames]
        return [(b[i], b[i + 1]) for i in range(n)]


def chop(word, note, dur, fs_out=SR):
    """A vocal chop: the vowel of `word` re-pitched to `note` for `dur` seconds."""
    v = np.where(word.voiced)[0]
    if not len(v):
        return np.zeros(int(dur * fs_out))
    a, b = v[len(v) // 3], v[2 * len(v) // 3] + 1
    n = max(2, int(dur / (FRAME / 1000)))
    src = np.linspace(a, b - 1, n).astype(int)
    f0 = np.full(n, float(hz(note)))
    y = pw.synthesize(f0, np.ascontiguousarray(word.sp[src]), np.ascontiguousarray(word.ap[src]), word.fs, FRAME)
    y = up(y, word.fs, fs_out)
    k = min(len(y) // 2, int(0.01 * fs_out))
    y[:k] *= np.linspace(0, 1, k)
    y[-k * 3:] *= np.linspace(1, 0, k * 3)
    return y


def measure_pitch(audio, notes, sr=SR):
    """Track f0 of the sung lead and compare to the intended notes. Returns cents errors per voiced frame."""
    x = signal.resample_poly(audio, 16000, sr).astype(np.float64)
    f0, t = pw.harvest(x, 16000, f0_floor=100, f0_ceil=700, frame_period=10)
    errs = []
    for nd in notes:
        a = nd["t"] + min(0.06, nd["dur"] * 0.3)  # skip the glide at the start of each note
        b = nd["t"] + nd["dur"] - 0.02
        m = (t >= a) & (t <= b) & (f0 > 0)
        if m.any():
            errs.extend(list(1200 * np.log2(f0[m] / float(hz(nd["midi"])))))
    return np.array(errs)


# ---------- line-level singing (v3) ----------
# One Piper utterance per line, analysed once with WORLD. Consonants keep their own timing, pitch and
# aperiodicity; only voiced frames are retuned and stretched. The line is resynthesized in one pass, so there
# are no splices between syllables. This replaced per-word splicing, which clicked and blurred the words.

def _runs(mask):
    d = np.diff(np.r_[0, mask.astype(int), 0])
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


def _clean_voicing(f0, min_run=8, max_gap=4):
    """Drop voiced blips shorter than min_run frames and bridge unvoiced gaps shorter than max_gap."""
    f0 = f0.copy()
    v = f0 > 0
    for a, b in _runs(~v):
        if 0 < a and b < len(f0) and b - a < max_gap:
            f0[a:b] = np.interp(np.arange(a, b), [a - 1, b], [f0[a - 1], f0[b]])
    v = f0 > 0
    for a, b in _runs(v):
        if b - a < min_run:
            f0[a:b] = 0
    return f0


def _segments(f0, sp, n_syl):
    """Split the voiced runs into about n_syl syllable nuclei at energy dips. Returns [(a, b)] in frames."""
    segs = [(a, b) for a, b in _runs(f0 > 0)]
    energy = np.convolve(np.log(sp.sum(axis=1) + 1e-12), np.ones(5) / 5, mode="same")
    while len(segs) < n_syl:
        best = None
        for i, (a, b) in enumerate(segs):
            if b - a < 24:
                continue
            for c in range(a + 10, b - 10):
                if energy[c] <= energy[c - 1] and energy[c] <= energy[c + 1]:
                    depth = min(energy[a:c].max(), energy[c:b].max()) - energy[c]
                    if best is None or depth > best[0]:
                        best = (depth, i, c)
        if best is None or best[0] < 0.4:
            break
        _, i, c = best
        a, b = segs[i]
        segs[i:i + 1] = [(a, c), (c, b)]
    return segs


class Line:
    """A sung line analysed once; render() can then place it on different notes (lead, harmony)."""

    def __init__(self, voice, text, speed=1.15):
        fs = voice.config.sample_rate
        x = tts(voice, text, speed, native=True)
        x = np.concatenate([np.zeros(int(0.02 * fs)), x, np.zeros(int(0.04 * fs))])
        f0, t = pw.harvest(x, fs, f0_floor=70, f0_ceil=500, frame_period=FRAME)
        self.fs, self.text = fs, text
        self.sp = pw.cheaptrick(x, f0, t, fs)
        self.ap = pw.d4c(x, f0, t, fs)
        self.f0 = _clean_voicing(f0)
        n_syl = sum(syllable_count(w) for w in split_words(text))
        self.segs = _segments(self.f0, self.sp, n_syl)
        v = self.f0 > 0
        self.median = float(np.median(self.f0[v])) if v.any() else 200.0

    def plan(self, span, step, grid=2, fill=0.92):
        """Map source frames to output time so each nucleus starts on the grid. Returns (src_index_per_out_frame,
        onset/offset per segment in seconds)."""
        fp = FRAME / 1000
        n = len(self.f0)
        v = self.f0 > 0
        segs = self.segs
        nat_on = np.array([a for a, _ in segs]) * fp
        lead_in = nat_on[0]
        # natural onsets scaled to the span, snapped to the grid, kept in order
        usable = span * fill - lead_in
        scale = usable / max(nat_on[-1] - lead_in + 0.35, 1e-3)
        g = grid if len(segs) * grid * step <= usable else 1
        on = []
        for t in nat_on:
            q = int(round((lead_in + (t - lead_in) * scale) / (step * g))) * g
            q = max(q, int(np.ceil(lead_in / step)))
            if on and q <= on[-1]:
                q = on[-1] + g
            on.append(q)
        out_on = np.array(on) * step
        # per-source-frame durations: unvoiced at 1x, voiced frames stretched to hit the next onset
        dur = np.ones(n) * fp
        bounds = [0] + [a for a, _ in segs] + [n]
        targets = [0.0] + list(out_on) + [None]
        for k in range(1, len(bounds) - 1):
            a, b = bounds[k], bounds[k + 1]
            want = (targets[k + 1] - targets[k]) if targets[k + 1] is not None else max(span * 0.97 - targets[k], fp * (b - a))
            vv = v[a:b]
            fixed = (~vv).sum() * fp
            nv = vv.sum()
            if nv and want > fixed:
                dur[a:b][vv] = (want - fixed) / nv
            else:  # too little room: squeeze everything evenly (rare, short notes)
                dur[a:b] = max(want, 0.3 * (b - a) * fp) / (b - a)
        # lead-in consonants end exactly at the first onset
        a0 = bounds[1]
        if a0:
            dur[:a0] = out_on[0] / a0 if out_on[0] > 0 else fp
        edges = np.r_[0, np.cumsum(dur)]
        n_out = int(edges[-1] / fp)
        src = np.interp(np.arange(n_out) * fp, edges[:-1], np.arange(n))
        seg_out = []
        for (a, b), o in zip(segs, out_on):
            seg_out.append((o, float(np.interp(b, np.arange(n + 1), edges))))
        return src, seg_out

    def render(self, notes, span, step, strength=1.0, glide=0.035, vib=20, grid=2, expr=0.35, plan=None):
        """notes: MIDI per segment. strength 1 = fully on the notes; expr keeps a little of the spoken
        pitch movement inside each note so it sounds less like a machine."""
        fp = FRAME / 1000
        src, seg_out = plan or self.plan(span, step, grid)
        i0 = np.floor(src).astype(int)
        i1 = np.minimum(i0 + 1, len(self.f0) - 1)
        fr = (src - i0)[:, None]
        sp = np.exp((1 - fr) * np.log(self.sp[i0] + 1e-16) + fr * np.log(self.sp[i1] + 1e-16))
        ap = (1 - fr) * self.ap[i0] + fr * self.ap[i1]
        f0s = np.where((self.f0[i0] > 0) & (self.f0[i1] > 0),
                       np.exp((1 - fr[:, 0]) * np.log(np.maximum(self.f0[i0], 1)) + fr[:, 0] * np.log(np.maximum(self.f0[i1], 1))),
                       0.0)
        voiced = f0s > 0
        # target pitch per output frame: segment k's note from its onset until the next onset
        t = np.arange(len(src)) * fp
        seg_idx = np.searchsorted([o for o, _ in seg_out], t, side="right") - 1
        seg_idx = np.clip(seg_idx, 0, len(notes) - 1)
        target = np.log2(np.array([float(hz(notes[k])) for k in seg_idx]))
        # spoken micro-movement around the line's smoothed contour
        lf = np.log2(np.where(voiced, f0s, self.median))
        k = max(1, int(0.12 / fp))
        smooth = np.convolve(lf, np.ones(k) / k, mode="same")
        target = target + expr * (lf - smooth) * voiced
        # portamento: one-pole smoothing in log-frequency, restarted at each voiced onset
        a = np.exp(-fp / glide)
        out = np.empty_like(target)
        cur = target[0]
        for i in range(len(target)):
            if i and voiced[i] and not voiced[i - 1]:
                cur = target[i]
            cur = a * cur + (1 - a) * target[i]
            out[i] = cur
        # vibrato that grows in on held notes
        held = np.zeros(len(t))
        for (o, _), j in zip(seg_out, range(len(seg_out))):
            m = (seg_idx == j)
            held[m] = t[m] - o
        out = out + (vib / 1200) * np.clip((held - 0.22) / 0.2, 0, 1) * np.sin(2 * np.pi * 5.3 * t)
        tuned = 2 ** out
        orig = np.where(voiced, f0s, 0)
        f0 = np.where(voiced, 2 ** ((1 - strength) * np.log2(np.maximum(orig, 1)) + strength * np.log2(tuned)), 0.0)
        y = pw.synthesize(f0, np.ascontiguousarray(sp), np.ascontiguousarray(ap), self.fs, FRAME)
        y = deess(up(y, self.fs))
        notes_out = [dict(t=o, dur=max(0.05, e - o), midi=float(notes[j])) for j, (o, e) in enumerate(seg_out)]
        return y, notes_out


def contour_notes(contour, k):
    return [contour[round(i * (len(contour) - 1) / max(1, k - 1))] for i in range(k)]


def deess(y, lo=5000, hi=10000, thr=0.35, ratio=3.0):
    """Turn down the 5-10 kHz band when it gets loud relative to the whole signal."""
    band = signal.sosfiltfilt(sos("bandpass", [lo, hi]), y)
    k = int(0.005 * SR)
    eb = np.sqrt(np.convolve(band ** 2, np.ones(k) / k, mode="same")) + 1e-9
    ea = np.sqrt(np.convolve(y ** 2, np.ones(k) / k, mode="same")) + 1e-9
    rel = eb / ea
    g = np.where(rel > thr, (thr / rel) ** (1 - 1 / ratio), 1.0)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    return y - band * (1 - g)


def count_clicks(y, sr=SR):
    """Glitch detector: sudden broadband jumps. Looks at the 6 kHz+ band in 1 ms frames and flags frames more
    than 18 dB above the median of the surrounding 40 ms, where the signal isn't near silence, and where the
    full-band level jumps too (a consonant onset rises over several ms; a click is one frame)."""
    hp = signal.sosfilt(sos("highpass", 6000), y)
    f = int(0.001 * sr)
    n = len(y) // f
    e_hp = np.sqrt((hp[:n * f].reshape(n, f) ** 2).mean(1)) + 1e-9
    e_all = np.sqrt((y[:n * f].reshape(n, f) ** 2).mean(1)) + 1e-9
    from scipy.ndimage import median_filter
    med = median_filter(e_hp, size=41)
    loud = e_all > 10 ** (-45 / 20) * np.max(np.abs(y))
    jump = 20 * np.log10(e_hp / med) > 18
    prev = np.r_[e_all[0], e_all[:-1]]
    nxt = np.r_[e_all[1:], e_all[-1]]
    spike = (e_all > 2.0 * prev) & (e_all > 1.6 * nxt)
    hits = np.where(jump & loud & spike)[0]
    # merge hits closer than 5 ms
    merged = [h for i, h in enumerate(hits) if i == 0 or h - hits[i - 1] > 5]
    return len(merged), [h / 1000 for h in merged]
