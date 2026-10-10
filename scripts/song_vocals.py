"""Vocals for the contribution song.

Verses: rap lines from a Piper TTS voice, fitted to their bars.
Sung parts: each word is synthesized with Piper, split into syllables, then re-synthesized with the
WORLD vocoder (pyworld) so every syllable sits on a melody note with its own length. WORLD keeps the
spectral envelope, so formants stay put while the pitch moves (no chipmunk effect). Harmony and double
tracks are rendered the same way at other pitches.
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
SING_VOICE = ("en_US-hfc_female-medium", "en_US/hfc_female/medium/")
FRAME = 5.0  # ms

# respellings in espeak phonemes, wrapped in [[ ]] so Piper reads them as written
PRONOUNCE = {
    "nishal": "[[nɪʃˈɑːl]]",      # nih-SHAAL
    "nishal21": "[[nɪʃˈɑːl]]",
    "neko": "[[nˈɛkoʊ]]",         # NEH-ko
    "nekodroid": "Neck-oh droid",     # IPA came out as "necker droid"; this spelling transcribes as NekoDroid
    "upi": "[[jˈuː pˈiː ˈaɪ]]",    # U-P-I
    "amv": "A M V",
    "cli": "[[sˈiː ˈɛl ˈaɪ]]",
    "api": "[[ˈeɪ pˈiː ˈaɪ]]",
}
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
    """How a repo name or word should be spoken: split on - _ . and CamelCase, respell known words."""
    low = name.lower()
    if low in PRONOUNCE:
        return PRONOUNCE[low]
    out = []
    for part in re.split(r"[-_. ]+", name):
        if part.lower() in PRONOUNCE:
            out.append(PRONOUNCE[part.lower()])
            continue
        for w in re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", part) or [part]:
            out.append(PRONOUNCE.get(w.lower(), w))
    return " ".join(out)


def tts(voice, text, speed=1.0, native=False):
    from piper import SynthesisConfig
    cfg = SynthesisConfig(length_scale=speed, noise_scale=0.6, noise_w_scale=0.7)
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64)
    idx = np.where(np.abs(a) > 0.015)[0]
    if len(idx):
        a = a[max(0, idx[0] - 80):idx[-1] + 200]
    return a if native else signal.resample_poly(a, SR, voice.config.sample_rate)


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


def _render_frames(word, syl_plan, prev_f0):
    """syl_plan: list of (syllable index, duration s, midi, vibrato). Returns f0, sp, ap frame arrays."""
    f0s, sps, aps = [], [], []
    fp = FRAME / 1000
    for k, (si, dur, note, vib) in enumerate(syl_plan):
        a, b = word.syl[si]
        v = word.voiced[a:b]
        head = int(np.argmax(v)) if v.any() else (b - a)
        n_out = max(2, int(round(dur / fp)))
        n_head = min(head, n_out // 3)
        n_rest = n_out - n_head
        src_head = np.linspace(a, a + head, n_head, endpoint=False) if n_head else np.array([])
        src_rest = np.linspace(a + head, b - 1, n_rest)
        src = np.concatenate([src_head, src_rest])
        i0 = np.floor(src).astype(int)
        i1 = np.minimum(i0 + 1, len(word.voiced) - 1)
        fr = (src - i0)[:, None]
        sp = np.exp((1 - fr) * np.log(word.sp[i0] + 1e-16) + fr * np.log(word.sp[i1] + 1e-16))
        ap = (1 - fr) * word.ap[i0] + fr * word.ap[i1]
        voiced = word.voiced[np.round(src).astype(int)]
        # keep the tail of the syllable voiced if the source was voiced near the end (sustained vowel)
        target = float(hz(note))
        t = np.arange(n_out) * fp
        curve = np.full(n_out, target)
        if prev_f0:
            g = min(n_out, 8)  # 40 ms glide in from the previous note
            curve[:g] = prev_f0 * (target / prev_f0) ** np.linspace(0, 1, g)
        depth = vib * np.clip((t - 0.18) / 0.15, 0, 1)
        curve *= 2 ** (depth * np.sin(2 * np.pi * 5.4 * t) / 1200)
        f0 = np.where(voiced, curve, 0.0)
        f0s.append(f0)
        sps.append(sp)
        aps.append(ap)
        if voiced.any():
            prev_f0 = target
    return np.concatenate(f0s), np.vstack(sps), np.vstack(aps), prev_f0


def sing_phrase(voice, words_cache, text, notes_fn, start, span, step, total_len, transpose=0, vib=25,
                grid=2, hold_to=None):
    """Sing `text` starting at `start` (s) within `span` seconds.

    notes_fn(i, K) gives the MIDI note for syllable i of K. Returns (audio, notes) where notes is a list of
    dicts {t, dur, midi, voiced_start} for doubling and analysis.
    """
    words = split_words(text)
    plan = []  # (word obj, syllable index, natural duration)
    for w in words:
        if w not in words_cache:
            words_cache[w] = Word(voice, w)
        wo = words_cache[w]
        for si, (a, b) in enumerate(wo.syl):
            plan.append((wo, si, (b - a) * FRAME / 1000, si == 0))
    K = len(plan)
    # natural onsets (small gap between words), scaled into the span, then snapped to the grid
    nat, t = [], 0.0
    for wo, si, d, first in plan:
        if first and nat:
            t += 0.04
        nat.append(t)
        t += d
    usable = span * 0.82
    scale = usable / max(t, 1e-3)
    steps_avail = int(usable / step)
    g = grid if K * grid <= steps_avail else 1
    on = []
    for i, n in enumerate(nat):
        q = int(round(n * scale / step / g)) * g
        if on and q <= on[-1]:
            q = on[-1] + g
        on.append(q)
    end_step = int(round((hold_to if hold_to else span * 0.95) / step))
    out = np.zeros(total_len)
    notes = []
    prev = None
    i = 0
    while i < K:
        wo = plan[i][0]
        j = i
        while j + 1 < K and plan[j + 1][0] is wo and plan[j + 1][1] > plan[j][1]:
            j += 1
        syl_plan = []
        for k in range(i, j + 1):
            nxt = on[k + 1] if k + 1 < K else max(end_step, on[k] + 2)
            dur_steps = (nxt - on[k]) if k == K - 1 else min(nxt - on[k], 6)
            dur = dur_steps * step - (0.03 if k < j else 0.05)
            midi = notes_fn(k, K) + transpose
            syl_plan.append((plan[k][1], max(0.06, dur), midi, vib))
            notes.append(dict(t=start + on[k] * step, dur=max(0.06, dur_steps * step - 0.03), midi=midi))
        f0, sp, ap, prev = _render_frames(wo, syl_plan, prev)
        y = pw.synthesize(f0, np.ascontiguousarray(sp), np.ascontiguousarray(ap), wo.fs, FRAME)
        y = signal.resample_poly(y, SR, wo.fs)
        # within a word, syllables run back to back; place the word at its first syllable onset
        s = int((start + on[i] * step) * SR)
        e = min(total_len, s + len(y))
        if s < total_len:
            fade = min(len(y), int(0.008 * SR))
            y[-fade:] *= np.linspace(1, 0, fade)
            out[s:e] += y[:e - s]
        # if syllables of one word don't run back to back on the grid, the word is stretched to fit already
        i = j + 1
    return out, notes


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
    y = signal.resample_poly(y, fs_out, word.fs)
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
