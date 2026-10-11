"""Stems for the remix in the player: the mastered song split into six parts, plus the drums replayed
on two other kits.

The stems come out of contribution_song.mixdown() already bus-processed, so they add up to the
pre-master mix. The master (glue compressor, loudness gain and limiter) is a single gain curve, and
every stem gets that same curve, so with every fader up the stems sum to the released MP3's audio.

Kits: every drum hit of the song is recorded with its time, velocity and pan (instrumental() in
contribution_song.py), then replayed here on the other voices, through the same drum bus, and
matched in loudness to the original drums so switching kits doesn't jump in level.

  original  the song's own drums
  dusty     lo-fi: rounder kick, papery snare, darker hats, a little tape saturation
  punchy    tight: clicky short kick, crisp snare, bright hats

Each stem is written twice: Ogg Opus (small, what browsers load) and MP3 (fallback for browsers
that can't decode Opus). Files go to assets/stems/, which is gitignored and copied to Pages.
"""
import json
import os
import subprocess
import tempfile

import numpy as np
from scipy import signal

import song_synth as S
from song_synth import SR, env, sos

STEMS = ("drums", "bass", "keys", "synths", "vocals", "fx")
KITS = ("original", "dusty", "punchy")
OPUS_KBPS = {"bass": 48, "fx": 48}  # everything else 64


class Kit:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)

    def noise(self, n):
        return self.rng.uniform(-1, 1, n)


class Dusty(Kit):
    def kick(self, v):
        n = int(SR * 0.5)
        t = np.arange(n) / SR
        f = 44 + 72 * np.exp(-t * 24)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.17)
        knock = signal.sosfilt(sos("bandpass", [900, 2600]), self.noise(n)) * env(n, 0.006) * 0.25
        return v * np.tanh(2.0 * (body + knock)) * 0.85

    def snare(self, v):
        n = int(SR * 0.32)
        t = np.arange(n) / SR
        body = np.sin(2 * np.pi * (172 + 30 * np.exp(-t * 50)) * t) * env(n, 0.06)
        nz = signal.sosfilt(sos("bandpass", [900, 5200]), self.noise(n)) * env(n, 0.11)
        return v * signal.sosfilt(sos("lowpass", 6500), 0.6 * body + 0.85 * nz)

    def clap(self, v):
        n = int(SR * 0.38)
        x = signal.sosfilt(sos("bandpass", [800, 3800]), self.noise(n))
        e = np.zeros(n)
        for off in (0, 0.012, 0.024):
            s0 = int(off * SR)
            e[s0:] += env(n - s0, 0.007 if off < 0.024 else 0.13)
        return v * 0.8 * x * e

    def hat(self, v, open_=False):
        n = int(SR * (0.34 if open_ else 0.07))
        x = signal.sosfilt(sos("bandpass", [5200, 9500]), self.noise(n))
        return v * 0.42 * x * env(n, 0.11 if open_ else 0.02)

    def rim(self, v):
        n = int(SR * 0.08)
        t = np.arange(n) / SR
        return v * 0.45 * (np.sin(2 * np.pi * 820 * t) + 0.6 * np.sin(2 * np.pi * 1290 * t)) * env(n, 0.022)

    def bus(self, x):
        x = signal.sosfilt(sos("lowpass", 8500), x, axis=1)
        return np.tanh(x * 1.6) / 1.6


class Punchy(Kit):
    def kick(self, v):
        n = int(SR * 0.34)
        t = np.arange(n) / SR
        f = 50 + 190 * np.exp(-t * 48)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.1)
        click = signal.sosfilt(sos("highpass", 3200), self.noise(n)) * env(n, 0.003) * 0.9
        return v * np.tanh(2.6 * (body + click)) * 0.85

    def snare(self, v):
        n = int(SR * 0.22)
        t = np.arange(n) / SR
        body = np.sin(2 * np.pi * (225 + 60 * np.exp(-t * 80)) * t) * env(n, 0.035)
        nz = signal.sosfilt(sos("highpass", 2400), self.noise(n)) * env(n, 0.065)
        return v * (0.5 * body + 1.0 * nz)

    def clap(self, v):
        n = int(SR * 0.3)
        x = signal.sosfilt(sos("bandpass", [1500, 8000]), self.noise(n))
        e = np.zeros(n)
        for off in (0, 0.007, 0.015):
            s0 = int(off * SR)
            e[s0:] += env(n - s0, 0.005 if off < 0.015 else 0.075)
        return v * 0.85 * x * e

    def hat(self, v, open_=False):
        n = int(SR * (0.26 if open_ else 0.05))
        x = signal.sosfilt(sos("highpass", 9000), self.noise(n))
        return v * 0.5 * x * env(n, 0.07 if open_ else 0.01)

    def rim(self, v):
        n = int(SR * 0.05)
        t = np.arange(n) / SR
        return v * 0.5 * (np.sin(2 * np.pi * 2100 * t) + 0.4 * signal.sosfilt(sos("highpass", 3000), self.noise(n))) * env(n, 0.008)

    def bus(self, x):
        return x


def replay(kit, hits, n):
    out = np.zeros((2, n))
    for kind, vel, p, gain, t, open_ in hits:
        x = kit.hat(vel, open_=True) if open_ else getattr(kit, kind)(vel)
        S.add(out, S.pan(x, p) * gain, t)
    out = kit.bus(out)
    return S.compress(out, thr_db=-14, ratio=3, attack=0.002, release=0.06) * 0.9


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)


def write_wav(path, x):
    import wave
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x.T * 32767).astype(np.int16).tobytes())


def encode(x, base, name):
    """Opus (.ogg) and MP3 copies of one stem. Returns their sizes."""
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "s.wav")
        mono = np.allclose(x[0], x[1], atol=1e-6)
        write_wav(wav, x[:1] if mono else x)
        kbps = OPUS_KBPS.get(name.split("-")[0], 64) // (2 if mono else 1)
        common = ["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-map_metadata", "-1"]
        ogg, mp3 = os.path.join(base, f"{name}.ogg"), os.path.join(base, f"{name}.mp3")
        subprocess.run(common + ["-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-application", "audio", ogg + ".tmp.ogg"], check=True)
        subprocess.run(common + ["-c:a", "libmp3lame", "-b:a", "96k" if not mono else "64k", mp3 + ".tmp.mp3"], check=True)
        os.replace(ogg + ".tmp.ogg", ogg)
        os.replace(mp3 + ".tmp.mp3", mp3)
    return os.path.getsize(ogg), os.path.getsize(mp3)


def export(stems, gain, hits, length, out_dir):
    """Master every stem with the song's gain curve, render the other kits and encode everything.
    Returns the stems entry for contribution-song.json."""
    os.makedirs(out_dir, exist_ok=True)
    m = int(SR * length)
    fade = int(SR * 2.0)
    g = gain[:m]
    files = {}
    ref = stems["drums"]
    for name in STEMS:
        files[name] = stems[name] * g
    n = ref.shape[1] + int(SR * 4)
    for kit_name, cls, seed in (("dusty", Dusty, 7), ("punchy", Punchy, 11)):
        x = replay(cls(seed), hits, max(n, m))[:, :m]
        x = x * (rms(ref) / rms(x))  # same loudness as the original drums before the master
        x[:, -fade:] *= np.linspace(1, 0, fade) ** 1.5
        files[f"drums-{kit_name}"] = x * g
    sizes = {}
    for name, x in files.items():
        sizes[name] = encode(x, out_dir, name)
    total = sum(a for a, _ in sizes.values())
    print("stems: " + ", ".join(f"{k} {a / 1024:.0f} KB" for k, (a, _) in sizes.items()) + f" (opus total {total / 1048576:.1f} MB)")
    info = dict(path="stems/", names=list(STEMS), kits=list(KITS), length=round(length, 3),
                bytes={k: dict(ogg=a, mp3=b) for k, (a, b) in sizes.items()})
    with open(os.path.join(out_dir, "stems.json"), "w") as f:
        json.dump(info, f, separators=(",", ":"))
    return info
