"""Vocals for the contribution song: two Piper TTS voices at their natural pitch.

Every line is one Piper utterance. Timing comes only from Piper's own speed setting (length_scale), so
there is no pitch shifting, vocoding or time-stretching anywhere. The only processing is resampling to the
song rate, a low-pass that removes resampling images, and a de-esser.
"""
import os
import urllib.request

import numpy as np
from scipy import signal

from song_lyrics import say_name as _say_name
from song_synth import SR, sos

VOICE_DIR = os.environ.get("PIPER_VOICE_DIR", os.path.expanduser("~/.cache/piper-voices"))
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/"
RAP_VOICE = ("en_US-ryan-high", "en_US/ryan/high/")
SING_VOICE = ("en_US-hfc_male-medium", "en_US/hfc_male/medium/")  # chorus and breakdown: clearest of 8 male voices auditioned


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
    scale = float(np.clip(0.95 * 0.88 * window / (len(x) / SR), 0.72, 1.2))
    if abs(scale - 0.95) > 0.03:
        x = tts(voice, text, scale)
    if len(x) / SR > window * 0.98:
        x = x[: int(window * 0.98 * SR)]
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
