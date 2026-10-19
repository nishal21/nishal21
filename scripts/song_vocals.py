"""Vocals for the contribution song (and the visitor song's backup): two Kokoro-82M TTS voices (Apache-2.0, runs on
the CPU through kokoro-onnx): a male voice raps the verses, a female voice takes the chorus, at their natural pitch.

Every line is one Kokoro utterance. Timing comes only from Kokoro's own speed setting, so there is no pitch shifting,
vocoding or time-stretching anywhere. The only processing is resampling to the song rate, a low-pass that removes
resampling images, and a de-esser. `speed` below keeps Piper's meaning (a length scale: 1.6 is slower), so the
arrangement code didn't change.
"""
import os
import re
import urllib.request

import numpy as np
from scipy import signal

from song_lyrics import say_name as _say_name
from song_synth import SR, sos

VOICE_DIR = os.environ.get("KOKORO_DIR", os.path.expanduser("~/.cache/kokoro"))
REL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL, VOICES = "kokoro-v1.0.int8.onnx", "voices-v1.0.bin"
RAP_VOICE = ("am_michael",)   # clear, steady male voice for the verses
SING_VOICE = ("af_heart",)    # the clearest Kokoro voice, for the chorus and the visitor song
SING_SPEED = 1.6  # length scale for the chorus: slow and relaxed
_K = {}


class _Voice:
    def __init__(self, name):
        self.name = name
        self.config = type("C", (), {"sample_rate": 24000})()


def _kokoro():
    if "k" not in _K:
        from kokoro_onnx import Kokoro
        os.makedirs(VOICE_DIR, exist_ok=True)
        for f in (MODEL, VOICES):
            if not os.path.exists(os.path.join(VOICE_DIR, f)):
                urllib.request.urlretrieve(REL + f, os.path.join(VOICE_DIR, f))
        _K["k"] = Kokoro(os.path.join(VOICE_DIR, MODEL), os.path.join(VOICE_DIR, VOICES))
    return _K["k"]


def load(spec):
    """spec = (Kokoro voice name,)."""
    _kokoro()
    return _Voice(spec[0])


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


def tts(voice, text, speed=1.0, native=False, noise=None, noise_w=None):
    """speed is a length scale (Piper's convention): Kokoro is asked for 1/speed. noise args are unused (Kokoro has none)."""
    text = re.sub(r"\[\[[^\]]*\]\]", "Nishal", text)  # Piper phoneme spellings: Kokoro reads the plain name
    a, fs = _kokoro().create(text, voice=voice.name, speed=float(np.clip(1.0 / speed, 0.5, 2.0)), lang="en-us")
    a = np.asarray(a, dtype=np.float64)
    idx = np.where(np.abs(a) > 0.015)[0]
    if len(idx):
        a = a[max(0, idx[0] - 80):idx[-1] + 200]
    return a if native else up(a, voice.config.sample_rate)


# ---------- rap ----------

def rap_line(voice, text, window):
    """Speak a line so it fills ~88% of its window, within natural speed limits."""
    x = tts(voice, text, 0.95)
    scale = float(np.clip(0.95 * 0.88 * window / (len(x) / SR), 0.72, 1.2))
    if abs(scale - 0.95) > 0.03:
        x = tts(voice, text, scale)
    if len(x) / SR > window * 0.98:
        x = x[: int(window * 0.98 * SR)]
        x[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return signal.sosfilt(sos("highpass", 90), x)


def phrase(voice, text, speed, max_len):
    """Speak a short phrase at a set length scale. If it runs past max_len seconds, ask Kokoro for a
    slightly faster take (never below 1.0); trim with a fade only as a last resort."""
    while True:
        x = tts(voice, text, speed)
        if len(x) / SR <= max_len or speed <= 1.0:
            break
        speed = max(1.0, speed - 0.1)
    if len(x) / SR > max_len:
        x = x[: int(max_len * SR)]
        x[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return signal.sosfilt(sos("highpass", 90), x)


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
