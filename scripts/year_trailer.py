"""Year trailer: a ~45 second edit of my year on GitHub, cut to the contribution song.

  python3 scripts/year_trailer.py video <out dir> [--site _site/player] [--only wide|tall]
      trailer.mp4 (1920x1080), trailer-vertical.mp4 (1080x1920), trailer-poster.jpg and trailer.json
      (the cut list, for checking the sync). Needs contribution-song.json and the MP3 in --site.
  python3 scripts/year_trailer.py poster
      assets/trailer-dark.svg and trailer-light.svg, the README card, from assets/contribution-song.json.

The edit uses whole bars of the song (Intro, the first Build into the Chorus, the Breakdown, the second
Build into the Chorus, the Outro), so every splice falls on a downbeat. It runs at 28 fps because at
140 BPM a 16th note is exactly 3 frames, so every cut, slam and flash lands on a frame boundary with
no rounding. Structure:

  intro      4 bars  the voice says the handle; the year's grid fills in on the hats
  build      2 bars  months on 8ths, then the count running up on 16ths, one 8th of black before the drop
  drop       4 bars  impact frame, total, busiest week, busiest day and streak, top repos on the beat
  breather   4 bars  the whole grid with a slow push, then languages
  build      2 bars  releases on 8ths, then 16ths
  final drop 6 bars  impact frame, the counts slam on kick and snare, new repos on 8ths, the grid lights up
  outro      3 bars  the handle and links, fade to black

The soundtrack is scored to this cut list rather than just cut from the song: the song's stems are laid on
the trailer's timeline, the 808 drops out of the builds while a riser and a high-pass take over, everything
stops on the black 8th, each drop opens on an impact, the slams and section cuts get hits, the breather sits
behind a low-pass that opens into the second build, and the outro lands on a last hit with an A minor chord
under the handle. Mastered to -14 LUFS with a -1.5 dBTP ceiling. Without the stems it falls back to the
plain song edit with the same hits on top.

Only public repos appear: everything comes from contribution-song.json, which the song step builds from
public data (song_data.py). Frames are drawn with Pillow in a few worker processes and piped to ffmpeg.
"""
import json
import math
import os
import subprocess
import sys
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS = ROOT / "player" / "fonts"
sys.path.insert(0, str(HERE))
import song_synth as S  # noqa: E402
from common import ASSETS, LANG_COLORS, THEMES, FONT as CARD_FONT, MONO as CARD_MONO, esc, write_atomic  # noqa: E402

FPS = 28
SR = 44100
INK = (13, 14, 12)
PAPER = (245, 246, 240)
DIM = (128, 132, 122)
FAINT = (34, 36, 32)
SLEEVES = ["#a9d6f5", "#cbef4a", "#ff8a65", "#f6a6c6", "#7fe3b4", "#ffc53d",
           "#5cd6cf", "#ff9f43", "#c3b1ff", "#ff7a3d", "#e6d3a3", "#ff6b6b"]
HANDLE = "nishal21"
SITE_URL = "nishal21.github.io/nishal21"

# (first song bar, bars) of each piece of the song, in trailer order. Contiguous pieces are joined, so
# the builds run into their drops untouched; the 4 splices all sit on downbeats.
EDIT = [(0, 4), (12, 6), (34, 12), (48, 2), (52, None)]  # None: to the end of the song (its last bar + fade)
# The trailer's sections as plan() lays them out, in trailer bars. Written to trailer.json as chapters for the video page.
SECTIONS = [(0, "Intro"), (4, "Build"), (6, "Drop"), (10, "Breather"), (14, "Build"), (16, "Final drop"), (22, "Outro")]


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


@lru_cache(maxsize=256)
def font(size, weight=800, mono=False):
    size = max(6, int(round(size)))
    if mono:
        f = ImageFont.truetype(str(FONTS / "jetbrains-mono.woff2"), size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        return f
    f = ImageFont.truetype(str(FONTS / "bricolage-grotesque.woff2"), size)
    try:
        f.set_variation_by_axes([min(96, max(12, size)), weight])
    except Exception:
        pass
    return f


# ---------- data ----------

def load_song(site):
    return json.loads((Path(site) / "contribution-song.json").read_text())


def year_facts(song):
    """Everything the edit shows, with fallbacks when the song JSON has no year summary."""
    st = song["stats"]
    weeks = [w for w in song["weeks"] if w.get("start")]
    y = song.get("year") or {}
    releases = y.get("releases")
    created = y.get("created")
    if releases is None or created is None:  # older JSON: rebuild what we can from the week events
        releases, created = [], []
        for w in weeks:
            for e in w.get("events", []):
                if e["type"] == "release":
                    releases.append(dict(date=w["start"], repo=e["repo"], title=e["title"]))
                elif e["type"] == "repo":
                    created.append(dict(date=w["start"], repo=e["repo"], lang=w.get("lang")))
    langs = y.get("langs")
    if not langs:
        cnt = {}
        for w in weeks:
            if w.get("lang"):
                cnt[w["lang"]] = cnt.get(w["lang"], 0) + sum(w["days"])
        langs = [dict(name=k, commits=v) for k, v in sorted(cnt.items(), key=lambda x: -x[1])][:6]
    repos = y.get("repos") or [dict(name=r, commits=None, lang=None) for r in st.get("recent", [])]
    days = []
    for w in weeks:
        d0 = date.fromisoformat(w["start"])
        days += [(d0 + timedelta(days=i), c) for i, c in enumerate(w["days"])]
    months = {}
    for d, c in days:
        months[(d.year, d.month)] = months.get((d.year, d.month), 0) + c
    tot = [sum(w["days"]) for w in weeks]
    order = sorted(range(len(weeks)), key=lambda i: (-tot[i], i))
    return dict(stats=st, weeks=weeks, days=days, months=sorted(months.items()), week_totals=tot, busiest=order,
                releases=releases, created=created, langs=langs, repos=repos, prs=y.get("prs"),
                commits=y.get("commits"), ground=rgb(SLEEVES[int(st["month"][5:7]) - 1]))


def fmt_day(iso, year=True):
    d = date.fromisoformat(iso) if isinstance(iso, str) else iso
    return d.strftime("%b %-d, %Y" if year else "%b %-d")


# ---------- the edit: audio ----------

def decode(mp3):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(mp3), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).T.astype(np.float64)


def cut_audio(song, x):
    """Splice the song's bars into the trailer. The incoming piece starts at full level on its downbeat;
    the outgoing one rings on for 90 ms under it and fades, so reverb tails don't stop dead."""
    bar = song["bar"]
    pieces, t = [], 0
    for b0, nb in EDIT:
        a = int(round(b0 * bar * SR))
        e = x.shape[1] if nb is None else int(round((b0 + nb) * bar * SR))
        pieces.append((t, a, e))
        t += e - a
    out = np.zeros((2, t + SR))
    tail = int(0.09 * SR)
    for k, (at, a, e) in enumerate(pieces):
        seg = x[:, a:min(x.shape[1], e + (tail if k < len(pieces) - 1 else 0))].copy()
        if k < len(pieces) - 1 and seg.shape[1] > e - a:
            n = seg.shape[1] - (e - a)
            seg[:, e - a:] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 2
        out[:, at:at + seg.shape[1]] += seg
    out = out[:, :t]
    return out, [p[0] / SR for p in pieces]


def kick_onsets(y, bar):
    """Low-end hits in the trailer audio, snapped to the 16th grid (for camera shake)."""
    from scipy import signal
    mono = y.mean(0)
    low = signal.sosfilt(signal.butter(4, 140, "lowpass", fs=SR, output="sos"), mono)
    e = np.convolve(np.abs(low), np.ones(256) / 256, mode="same")
    hop = 128
    env = e[::hop]
    d = np.maximum(0, np.diff(env, prepend=env[0]))
    thr = np.percentile(d, 99) * 0.35
    out, last = [], -1
    six = bar / 16
    for i in np.flatnonzero(d > thr):
        t = i * hop / SR
        if t - last < six * 0.9:
            continue
        last = t
        out.append(round(t / six) * six)
    return sorted(set(round(v, 5) for v in out))


def vocal_onsets(site, start, end, song_bar):
    """Where speech starts inside [start, end) of the song, from the vocal stem (if the stems were built)."""
    p = Path(site) / "stems" / "vocals.ogg"
    if not p.exists():
        return []
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(p),
                          "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True).stdout
    v = np.frombuffer(raw, np.float32)
    if not len(v):
        return []
    e = np.sqrt(np.convolve(v.astype(np.float64) ** 2, np.ones(320) / 320, mode="same"))[::160]  # 10 ms hops
    on = e > max(1e-4, e.max() * 0.08)
    starts, gap = [], 99
    for i, o in enumerate(on):
        if o and gap >= 14:  # a new phrase after 140 ms of quiet
            starts.append(start + i * 0.01)
        gap = 0 if o else gap + 1
    return starts


# ---------- the edit: the score ----------
# The soundtrack is rebuilt from the song's stems on the trailer's own timeline, then the picture's events
# are scored on top: a riser into each drop, a beat of silence on the black 8th, an impact on each impact
# frame, hits on the slams and section cuts, a filtered breather, a last hit and a held chord under the
# handle. Every hit is placed from the cut list, so it lands on the frame it belongs to.

STEM_NAMES = ["drums", "bass", "keys", "synths", "vocals", "fx"]


def load_stems(site):
    p = Path(site) / "stems"
    if not all((p / f"{n}.ogg").exists() for n in STEM_NAMES):
        return None
    out = {}
    for n in STEM_NAMES:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(p / f"{n}.ogg"), "-f", "f32le", "-ar", str(SR), "-"],
                             check=True, capture_output=True).stdout
        x = np.frombuffer(raw, np.float32).astype(np.float64)
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0",
                                str(p / f"{n}.ogg")], capture_output=True, text=True).stdout.strip()
        ch = int(probe or 2)
        x = x.reshape(-1, ch).T
        out[n] = np.vstack([x, x]) if ch == 1 else x  # mono stems are the same signal in both channels
    return out


class Fx:
    """Trailer sound design: impacts, hits, risers. Seeded, so a rebuild with the same data sounds the same."""

    def __init__(self):
        self.r = np.random.default_rng(2112)

    def nz(self, n, ch=2):
        return self.r.uniform(-1, 1, (ch, n))

    @staticmethod
    def env(n, tau):
        return np.exp(-np.arange(n) / (SR * tau))

    def boom(self, sec=2.6, f0=64.0, f1=30.0, tau=0.7):
        from scipy import signal
        n = int(SR * sec)
        t = np.arange(n) / SR
        f = f1 + (f0 - f1) * np.exp(-t / 0.12)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR)
        x = np.tanh(1.6 * x) / np.tanh(1.6) * self.env(n, tau)
        click = signal.sosfilt(signal.butter(2, [1500, 6000], "bandpass", fs=SR, output="sos"), self.r.uniform(-1, 1, n)) * self.env(n, 0.006)
        return np.vstack([x + 0.4 * click, x + 0.4 * click])

    def crash(self, sec=2.0, tau=0.55, lo=2500):
        from scipy import signal
        n = int(SR * sec)
        x = signal.sosfilt(signal.butter(2, lo, "highpass", fs=SR, output="sos"), self.nz(n), axis=1)
        x = signal.sosfilt(signal.butter(1, 11000, "lowpass", fs=SR, output="sos"), x, axis=1)
        return x * self.env(n, tau) * (1 - np.exp(-np.arange(n) / (SR * 0.002)))

    def impact(self, size=1.0):
        """Sub boom, a crash, and a short room on the drop."""
        b = self.boom(sec=2.0 + size, tau=0.45 + 0.35 * size) * (0.9 + 0.1 * size)
        c = self.crash(sec=1.6 + size, tau=0.35 + 0.4 * size) * 0.32
        x = np.zeros((2, max(b.shape[1], c.shape[1])))
        x[:, :b.shape[1]] += b
        x[:, :c.shape[1]] += c
        return x + S.reverb(x * 0.5, seconds=2.4, decay=0.6) * 0.35 * size

    def hit(self, weight=1.0):
        """A punch for a slam: a short low thump, a clap, a little air."""
        k = S.kick(1.0)
        cl = S.clap(0.9)
        n = int(SR * 0.6)
        x = np.zeros((2, n))
        x[:, :len(k)] += k * 0.9 * weight
        x[0, :len(cl)] += cl * 0.55
        x[1, :len(cl)] += cl * 0.55
        x[:, :int(SR * 0.4)] += self.crash(0.4, tau=0.09, lo=5000) * 0.25
        return x + S.reverb(x * 0.3, seconds=1.2, decay=0.4) * 0.3

    def riser(self, sec, top=9000.0, tone=True):
        """Noise swept up through a band-pass, and a saw rising two octaves, both swelling to the end."""
        from scipy import signal
        n = int(SR * sec)
        x = self.nz(n)
        out = np.zeros_like(x)
        blocks = 96
        zi = None
        for i in range(blocks):
            a, b = i * n // blocks, (i + 1) * n // blocks
            fc = 250 * (top / 250) ** (i / (blocks - 1))
            sos = signal.butter(2, [fc * 0.6, min(fc * 1.6, 20000)], "bandpass", fs=SR, output="sos")
            if zi is None:
                zi = np.zeros((sos.shape[0], 2, 2))
            out[:, a:b], zi = signal.sosfilt(sos, x[:, a:b], axis=1, zi=zi)
        p = np.linspace(0, 1, n)
        y = out * 0.9 * p ** 2.2
        if tone:
            f = 110 * 2 ** (2 * p ** 1.4)  # A2 up two octaves
            saw = sum(S.polyblep_saw(f * 2 ** (d / 1200), n) for d in (-9, 0, 9)) / 3
            saw = signal.sosfilt(signal.butter(2, 3500, "lowpass", fs=SR, output="sos"), saw)
            y += np.vstack([saw, saw]) * 0.16 * p ** 1.8
        return y

    def swell(self, sec):
        """Reversed cymbal: grows into the hit it leads to."""
        return self.crash(sec, tau=sec * 0.35, lo=4000)[:, ::-1] * 0.5

    def downlifter(self, sec):
        from scipy import signal
        n = int(SR * sec)
        x = self.nz(n)
        out = np.zeros_like(x)
        blocks = 64
        zi = None
        for i in range(blocks):
            a, b = i * n // blocks, (i + 1) * n // blocks
            fc = 6000 * (180 / 6000) ** (i / (blocks - 1))
            sos = signal.butter(2, [fc * 0.6, min(fc * 1.6, 20000)], "bandpass", fs=SR, output="sos")
            if zi is None:
                zi = np.zeros((sos.shape[0], 2, 2))
            out[:, a:b], zi = signal.sosfilt(sos, x[:, a:b], axis=1, zi=zi)
        return out * (1 - np.linspace(0, 1, n)) ** 2 * 0.5

    def chord(self, sec):
        """A minor, held under the handle at the end."""
        n = int(SR * sec)
        x = S.warm_pad([45, 52, 57, 60, 64, 69], n, cutoff=2400)
        x *= np.linspace(1, 0, n) ** 1.6
        return x + S.reverb(x * 0.6, seconds=3.0, decay=0.7) * 0.5


def place_audio(buf, x, t, gain=1.0, end=False):
    """Mix x into buf at t seconds (or ending at t when end=True)."""
    a = int(round(t * SR)) - (x.shape[1] if end else 0)
    if a < 0:
        x, a = x[:, -a:], 0
    b = min(buf.shape[1], a + x.shape[1])
    if b > a:
        buf[:, a:b] += x[:, :b - a] * gain


def sweep(x, t0, t1, f0, f1, kind="lowpass"):
    """A filter swept from f0 to f1 between t0 and t1 (seconds); x unchanged outside."""
    from scipy import signal
    a, b = int(t0 * SR), min(x.shape[1], int(t1 * SR))
    y = x.copy()
    blk = 256
    zi = None
    for i in range(a, b, blk):
        p = (i - a) / max(1, b - a)
        fc = f0 * (f1 / f0) ** (p ** 1.5)
        sos = signal.butter(2, min(fc, SR / 2 * 0.95), kind, fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2, 2))
        y[:, i:i + blk], zi = signal.sosfilt(sos, x[:, i:i + blk], axis=1, zi=zi)
    # keep filtering at the last cutoff for 20 ms while crossfading back to the dry signal, so nothing clicks
    k = min(int(0.02 * SR), x.shape[1] - b)
    if k > 0 and zi is not None:
        sos = signal.butter(2, min(f1, SR / 2 * 0.95), kind, fs=SR, output="sos")
        tail, _ = signal.sosfilt(sos, x[:, b:b + k], axis=1, zi=zi)
        w = np.linspace(0, 1, k)
        y[:, b:b + k] = tail * (1 - w) + x[:, b:b + k] * w
    return y


def gain_curve(n, points):
    """Piecewise-linear gain from (seconds, gain) points."""
    ts = np.array([p[0] for p in points]) * SR
    gs = np.array([p[1] for p in points])
    return np.interp(np.arange(n), ts, gs)


def score(song, site, shots, n_samples):
    """The trailer soundtrack, scored to the cut list. Returns (stereo, report)."""
    bar = song["bar"]
    T = lambda b: b * bar  # trailer bar -> seconds
    fr = lambda f: f / FPS
    stems = load_stems(site)
    if stems is None:  # no stems: the plain song edit, still with the hits on top
        bed, _ = cut_audio(song, decode(Path(site) / "contribution-song.mp3"))
        tracks = {"mix": bed}
    else:
        tracks = {k: cut_audio(song, v)[0] for k, v in stems.items()}
    n = n_samples
    for k in tracks:
        x = np.zeros((2, n))
        m = min(n, tracks[k].shape[1])
        x[:, :m] = tracks[k][:, :m]
        tracks[k] = x
    ramp = 0.012
    if stems is not None:
        tracks["fx"] *= 0  # the song's own risers and hits are replaced by ones placed on the picture
        # vocals: the intro line, the first hook line of each drop ("Light up the grid"), the breakdown line
        # over the grid, and the outro line under the handle. The rest of the chorus would talk over the numbers.
        tracks["vocals"] *= gain_curve(n, [(0, 1), (T(7.62), 1), (T(7.62) + 0.15, 0), (T(10) - 0.01, 0), (T(10), 1),
                                           (T(17.62), 1), (T(17.62) + 0.15, 0), (T(22) - 0.01, 0), (T(22), 1), (n / SR, 1)])
        tracks["drums"] *= gain_curve(n, [(0, 1), (T(10), 1), (T(10) + ramp, 0.55), (T(13.5), 0.55), (T(14), 1), (n / SR, 1)])
        # builds: the 808 drops out and the band climbs from 60% to full, so the drop has somewhere to go
        build = lambda b0: [(T(b0), 1), (T(b0) + 0.4, 0.55), (T(b0 + 1.875), 0.78)]
        tracks["bass"] *= gain_curve(n, [(0, 1), (T(4), 1), (T(4) + 0.43, 0), (T(6) - 0.01, 0), (T(6), 1),
                                         (T(14), 1), (T(14) + 0.43, 0), (T(16) - 0.01, 0), (T(16), 1), (n / SR, 1)])
        bed = gain_curve(n, [(0, 1)] + build(4) + [(T(6) - 0.01, 0.95), (T(6), 1)] + build(14) + [(T(16) - 0.01, 0.95), (T(16), 1), (n / SR, 1)])
        for k in ("drums", "keys", "synths"):
            tracks[k] *= bed
        music = sum(tracks[k] for k in ("drums", "bass", "keys", "synths"))
        vox = tracks["vocals"]
    else:
        music, vox = tracks["mix"], np.zeros((2, n))
    # breather: the band goes behind a low-pass that opens back up across the four bars into the build
    music = sweep(music, T(10), T(14), 650, 16000)
    # and a high-pass climbing through each build (thins the band out as the riser takes over)
    for b0 in (4, 14):
        music = sweep(music, T(b0), T(b0 + 1.875), 30, 420, "highpass")
    # the black 8th before each drop: everything stops
    gate = np.ones(n)
    blacks = [s for s in shots if s.kind == "black"]
    for s in blacks:
        a, b = int(fr(s.f0) * SR), int(fr(s.f1) * SR)
        k = int(0.006 * SR)
        gate[a:b] = 0
        gate[a - k:a] = np.linspace(1, 0, k)
    music *= gate
    vox *= gate
    fx = Fx()
    sfx = np.zeros((2, n))
    events = []
    impacts = [s for s in shots if s.kind == "impact"]
    duck = []
    # intro: a swell into the grid filling in, a hit when the name lands
    place_audio(sfx, fx.swell(T(1)), T(2), 0.5, end=True)
    place_audio(sfx, fx.hit(0.8), T(3), 0.75); events.append((T(3), "hit: name"))
    # builds: a riser up to the black 8th, a short swell inside it, then the impact on the drop
    for i, imp in enumerate(impacts):
        drop = fr(imp.f0)
        blk = next(s for s in blacks if s.f1 == imp.f0)
        size = 1.0 if i == 0 else 1.35
        r = fx.riser(fr(blk.f0) - (drop - 2 * bar), top=8000 if i == 0 else 11000)
        place_audio(sfx, r, fr(blk.f0), 0.3 if i == 0 else 0.38, end=True)
        place_audio(sfx, fx.swell(fr(blk.f1 - blk.f0) + 0.02), drop, 0.45, end=True)
        place_audio(sfx, fx.impact(size), drop, 0.95 if i == 0 else 1.0)
        place_audio(sfx, fx.downlifter(2 * bar), drop + 0.05, 0.22)
        duck.append((drop, 0.5))
        events.append((drop, f"impact {i + 1}"))
    # hits on the cuts that change the subject inside the drops, and on every slam
    for s in shots:
        t = fr(s.f0)
        if s.kind in ("slam", "stat", "final") and s.f0 not in {i.f1 for i in impacts}:
            place_audio(sfx, fx.hit(1.0 if s.kind != "final" else 1.2), t, 0.7)
            duck.append((t, 0.25))
            events.append((t, f"hit: {s.kind}"))
        elif s.kind in ("week", "langs") or (s.kind == "repo" and s.kw.get("rank") == 1):
            place_audio(sfx, fx.hit(0.7), t, 0.5)
            events.append((t, f"hit: {s.kind}"))
    # out of the breather: a swell over the last two beats lifts it into the second build
    place_audio(sfx, fx.swell(T(0.5)) * 1.2, T(14), 0.6, end=True)
    # into the breather: a soft sub drop as the filter closes
    place_audio(sfx, fx.boom(sec=2.5, f0=48, f1=28, tau=0.9) * 0.5, T(10), 0.6)
    events.append((T(10), "sub drop: breather"))
    # the light-up: a short riser into the last slam
    fin = next((s for s in shots if s.kind == "final"), None)
    lu = next((s for s in shots if s.kind == "lightup"), None)
    if fin and lu:
        place_audio(sfx, fx.riser(fr(fin.f0 - lu.f0), top=12000, tone=False), fr(fin.f0), 0.5, end=True)
        place_audio(sfx, fx.crash(2.5, tau=0.8) * 0.3, fr(fin.f0), 0.8)
    # the end: the last hit under the handle and an A minor chord that rings out
    out = next(s for s in shots if s.kind == "outro")
    t_end = fr(out.f0)
    place_audio(sfx, fx.impact(1.2), t_end, 0.9)
    place_audio(sfx, fx.chord(n / SR - t_end), t_end, 0.22)
    duck.append((t_end, 0.5))
    events.append((t_end, "impact: outro"))
    # sidechain: the band dips under each impact and slam, so the hits cut through without being louder
    g = np.ones(n)
    for t, depth in duck:
        a = int(t * SR)
        r = np.arange(min(n - a, int(SR * 0.8)))
        g[a:a + len(r)] = np.minimum(g[a:a + len(r)], 1 - depth * np.exp(-r / (SR * 0.18)))
    music *= g
    mix_ = music + vox + sfx
    # the song's outro, the outro vocal and the chord carry the ending; the last 1.6 s fade with the picture
    end_fade = gain_curve(n, [(0, 1), (n / SR - 1.6, 1), (n / SR, 0)])
    mix_ *= end_fade ** 1.5
    return master_trailer(mix_), events


def master_trailer(x, target=-14.0, ceiling=-1.5):
    """Glue compression, then loudness to -14 LUFS with a true-peak limiter (iterated)."""
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    peak = np.max(np.abs(x)) + 1e-9
    x = S.compress(x / peak * 0.5, thr_db=-14, ratio=2.0, attack=0.01, release=0.2)
    for _ in range(5):
        lu = meter.integrated_loudness(x.T)
        x = S.limit(x * 10 ** ((target - lu) / 20), ceiling_db=ceiling)
    return x


# ---------- the edit: pictures ----------

class Shot:
    def __init__(self, f0, f1, kind, **kw):
        self.f0, self.f1, self.kind, self.kw = f0, f1, kind, kw


def plan(song, F, site):
    """Cut list in frames. One bar = 48 frames, a beat 12, an 8th 6, a 16th 3."""
    BAR, BEAT, E8, S16 = 48, 12, 6, 3
    shots = []

    def add(b, off, length, kind, **kw):
        f0 = b * BAR + off
        shots.append(Shot(f0, f0 + length, kind, **kw))

    st = F["stats"]
    # intro: 4 bars. Words follow the voice; the grid fills on the hats in bars 3-4.
    line = next((l for l in song["lines"] if l["section"] == "Intro"), None)
    words = []
    if line:
        on = vocal_onsets(site, line["t"] - 0.1, line["end"] + 0.2, song["bar"])
        parts = [p.strip() for p in line["text"].replace(".", ".|").replace(",", ",|").split("|") if p.strip()]
        times = on[:len(parts)] if len(on) >= len(parts) else [line["t"] + i * (line["end"] - line["t"]) / len(parts) for i in range(len(parts))]
        words = [(p.rstrip(".,"), int(round(t * FPS))) for p, t in zip(parts, times)]
    add(0, 0, 2 * BAR, "cold", words=words)
    add(2, 0, 2 * BAR, "fill")
    # build 1: months on 8ths, then the rest on 16ths and the count running up; black on the last 8th
    months = F["months"]
    cum, run = [], 0
    for _, c in months:
        run += c
        cum.append(run)
    for i in range(min(8, len(months))):
        add(4, i * E8, E8, "month", m=months[i], cum=cum[i])
    rest = months[8:]
    k = 0
    for i, m in enumerate(rest):
        add(5, k * S16, S16, "month", m=m, cum=cum[8 + i], small=True)
        k += 1
    steps = 14 - k
    start_n = cum[7] if len(cum) > 7 else 0
    for j in range(steps):
        p = (j + 1) / steps
        add(5, k * S16, S16, "count", n=int(round(start_n + (st["total"] - start_n) * (1 - (1 - p) ** 2))), last=j == steps - 1)
        k += 1
    add(5, 14 * S16, 2 * S16, "black")
    # drop 1
    add(6, 0, 2, "impact", text=str(st["total"]))
    add(6, 2, BAR - 2, "hero", n=st["total"], label="contributions", sub=f"{fmt_day(st['first'])} to {fmt_day(st['last'])}")
    b = F["busiest"][0]
    add(7, 0, BAR, "week", w=F["weeks"][b], total=F["week_totals"][b])
    add(8, 0, 2 * BEAT, "stat", n=st["best_n"], label="in one day", sub=fmt_day(st["best"]))
    add(8, 2 * BEAT, 2 * BEAT, "stat", n=st["streak"], label="days in a row", sub=f"{fmt_day(st['streak_start'], False)} to {fmt_day(st['streak_end'], False)}")
    for i, r in enumerate(F["repos"][:4]):
        add(9, i * BEAT, BEAT, "repo", r=r, rank=i + 1)
    # breather
    add(10, 0, 2 * BAR, "grid", month=st["month"], month_n=st["month_n"], song_bar=EDIT[2][0])
    add(12, 0, 2 * BAR, "langs", langs=F["langs"])
    # build 2: releases, newest last
    rel = F["releases"][-22:]
    slots = [(14, i * E8, E8) for i in range(8)] + [(15, i * S16, S16) for i in range(14)]
    for i, (bb, off, ln) in enumerate(slots):
        if i < len(rel):
            add(bb, off, ln, "release", r=rel[i], n=i + 1)
        else:
            add(bb, off, ln, "count", n=len(F["releases"]), label="releases", last=i == len(slots) - 1)
    add(15, 14 * S16, 2 * S16, "black")
    # final drop
    add(16, 0, 2, "impact", text=str(len(F["releases"])))
    add(16, 2, 2 * BEAT - 2, "slam", n=len(F["releases"]), label="releases")
    if F["prs"] is not None:
        add(16, 2 * BEAT, 2 * BEAT, "slam", n=F["prs"], label="merged pull requests")
    else:
        add(16, 2 * BEAT, 2 * BEAT, "slam", n=st["active"], label="active days")
    add(17, 0, 2 * BEAT, "slam", n=len(F["created"]), label="new repos")
    add(17, 2 * BEAT, 2 * BEAT, "slam", n=F["commits"] or st["active"], label="commits to public repos" if F["commits"] else "active days")
    cr = F["created"]
    pick = [cr[round(i * (len(cr) - 1) / 15)] for i in range(16)] if len(cr) >= 16 else (cr * 16)[:16]
    for i, r in enumerate(pick):
        add(18 + i // 8, (i % 8) * E8, E8, "newrepo", r=r)
    add(20, 0, BAR + 2 * BEAT, "lightup")
    add(21, 2 * BEAT, 2 * BEAT, "final", n=st["total"])
    # outro: handle, links, fade
    add(22, 0, 3 * BAR + int(round(2.0 * FPS)), "outro")
    shots.sort(key=lambda s: s.f0)
    return shots


# ---------- drawing ----------

class Canvas:
    def __init__(self, W, H, ground):
        self.W, self.H = W, H
        self.u = min(W, H) / 1080 * (1.1 if H > W else 1)
        self.tall = H > W
        self.g = ground
        self.cache = {}

    def text(self, s, size, weight=800, color=PAPER, mono=False, track=0.0):
        """Text as a tight RGBA sprite (cached)."""
        key = (s, round(size), weight, color, mono, track)
        if key in self.cache:
            return self.cache[key]
        f = font(size, weight, mono)
        pad = int(size * 0.25)
        if track:
            ws = [f.getlength(ch) for ch in s]
            width = sum(ws) + track * size * (len(s) - 1)
        else:
            width = f.getlength(s)
        asc, desc = f.getmetrics()
        im = Image.new("RGBA", (int(width) + 2 * pad, asc + desc + 2 * pad), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if track:
            x = pad
            for ch, w in zip(s, ws):
                d.text((x, pad), ch, font=f, fill=color)
                x += w + track * size
        else:
            d.text((pad, pad), s, font=f, fill=color)
        bb = im.getbbox() or (0, 0, 1, 1)
        im = im.crop((bb[0], pad, bb[2], pad + asc + desc))  # keep the line box height so baselines agree
        self.cache[key] = im
        return im

    def fit(self, s, size, maxw, weight=800, mono=False, track=0.0):
        """Largest size <= size whose sprite fits maxw. Measured, not scaled: Bricolage's optical-size axis
        makes smaller text relatively wider, so one proportional step comes out too big."""
        for _ in range(6):
            f = font(size, weight, mono)
            w = f.getlength(s) + (track * size * (len(s) - 1) if track else 0)
            if w <= maxw or size <= 10:
                return size
            size = max(10, size * maxw / w * 0.985)
        return size


BOXES = None  # set to a list to record every placed sprite (x0, y0, x1, y1, alpha) for the layout check


def place(img, sp, cx, cy, scale=1.0, alpha=1.0, anchor="mm", trail=False):
    if scale > 1:  # an overshooting slam may grow, but not past the safe area once the camera has punched in
        scale = max(1.0, min(scale, img.width * (0.8 if img.height > img.width else 0.86) / max(1, sp.width)))
    if trail and scale > 1.04:  # a faint copy further out, so a fast slam reads as motion, not a jump
        global BOXES
        keep, BOXES = BOXES, None
        place(img, sp, cx, cy, min(1 + (scale - 1) * 1.7, img.width * 1.02 / max(1, sp.width)), alpha * 0.16, anchor)
        BOXES = keep
    if alpha <= 0.01:
        return
    if abs(scale - 1) > 0.002:
        w, h = max(1, int(sp.width * scale)), max(1, int(sp.height * scale))
        sp = sp.resize((w, h), Image.BILINEAR)
    if alpha < 0.999:
        sp = sp.copy()
        sp.putalpha(sp.getchannel("A").point(lambda v: int(v * alpha)))
    x = cx - (sp.width / 2 if anchor[0] == "m" else 0 if anchor[0] == "l" else sp.width)
    y = cy - (sp.height / 2 if anchor[1] == "m" else 0 if anchor[1] == "t" else sp.height)
    if BOXES is not None and alpha > 0.05:
        bb = sp.getbbox()
        if bb:
            BOXES.append((x + bb[0], y + bb[1], x + bb[2], y + bb[3], alpha))
    img.alpha_composite(sp, (int(round(x)), int(round(y))))


def slam(lf):
    """Scale and alpha for text that lands on a hit: big and fast in, settled in 4 frames."""
    s = 1 + 0.32 * math.exp(-lf / 1.0)
    return s, 1.0


def ease_out(p):
    return 1 - (1 - min(1, max(0, p))) ** 3


def lang_color(name):
    c = LANG_COLORS.get(name or "", "#8b949e")
    return mix(rgb(c), INK, 0.12)


def draw_grid(c, img, F, cx, cy, w, h, lit=None, alpha=1.0, highlight_month=None, flare=None):
    """The year's contribution grid: weeks across (down when tall), days the other way."""
    weeks = F["weeks"]
    n = len(weeks)
    dmax = max(1, max(max(wk["days"]) for wk in weeks))
    strips = 3 if c.tall else 1  # tall frames: the year in three strips, read left to right like the GitHub graph
    per = -(-n // strips)
    sgap = 1.6
    cols, rows = per, 7 * strips + sgap * (strips - 1)
    cell = min(w / cols, h / rows)
    gap = cell * 0.18
    x0, y0 = cx - cols * cell / 2, cy - rows * cell / 2
    d = ImageDraw.Draw(img)
    for i, wk in enumerate(weeks):
        for j, cnt in enumerate(wk["days"]):
            lv = 0 if not cnt else 0.28 + 0.72 * math.sqrt(cnt / dmax)
            on = 1.0 if lit is None else lit(i, j)
            if highlight_month:
                dd = date.fromisoformat(wk["start"]) + timedelta(days=j)
                if f"{dd.year}-{dd.month:02d}" != highlight_month:
                    on *= 0.35
            col = mix(FAINT, c.g, lv * on) if cnt else mix(INK, FAINT, 0.7 * alpha)
            if alpha < 1:
                col = mix(INK, col, alpha)
            fv = flare(i, j) if flare else 0
            if fv:
                col = mix(col, PAPER, (0.85 if cnt else 0.3) * fv)
            gx, gy = i % per, (i // per) * (7 + sgap) + j
            x, y = x0 + gx * cell, y0 + gy * cell
            d.rounded_rectangle([x + gap / 2, y + gap / 2, x + cell - gap / 2, y + cell - gap / 2], radius=cell * 0.22, fill=col)


def label(c, s, size=30, color=None, weight=500):
    size *= c.u * (1.4 if c.tall else 1.15)  # mono caps read small; phones need more
    size = c.fit(s.upper(), size, c.W * 0.82, weight, True, 0.14)
    return c.text(s.upper(), size, weight, color or DIM, mono=True, track=0.14)


def draw_shot(c, sh, f, F, song):
    W, H, u = c.W, c.H, c.u
    v = u * (1.3 if c.tall else 1)  # vertical spacing: the tall frame has room to breathe
    img = Image.new("RGBA", (W, H), INK + (255,))
    lf = f - sh.f0
    k = sh.kw
    cx, cy = W / 2, H / 2
    maxw = W * (0.76 if c.tall else 0.84)
    ny = cy - 40 * v  # every big number sits on this line, so count -> impact -> total cut on the same spot
    if sh.kind == "black":
        return img
    if sh.kind == "cold":
        # the grid barely there, words appearing with the voice
        # the grid is there from the first frame (dim, waiting), so the opening isn't a black screen
        draw_grid(c, img, F, cx, cy + (0 if c.tall else 40 * u), W * 0.8, H * (0.6 if c.tall else 0.42), alpha=(0.35 + 0.65 * min(1, lf / 40)) * (0.32 if c.tall else 0.5),
                  lit=lambda i, j: 0.25)
        words = k["words"]
        if not words or f < words[0][1]:
            place(img, label(c, "one year on github", 26), cx, cy - (230 if c.tall else 150) * u, alpha=ease_out((lf + 2) / 8))
        for i, (wd, at) in enumerate(words):
            if f < at:
                continue
            p = ease_out((f - at + 1) / 8)  # visible on the frame the word starts
            big = i == 0
            size = (150 if big else (84 if c.tall else 64)) * u
            sp = c.text(("@" + wd) if big and wd == HANDLE else wd, c.fit(wd, size, maxw), 800 if big else 650, PAPER if big else mix(DIM, PAPER, 0.5))
            yy = cy - (230 if c.tall else 150) * u + (0 if big else (150 + (110 if c.tall else 86) * (i - 1)) * u)
            place(img, sp, cx, yy + (1 - p) * 18 * u, alpha=p)
        return img
    if sh.kind == "fill":
        # bars 3-4: the grid fills column by column on 16ths
        n = len(F["weeks"])
        prog = (lf / (sh.f1 - sh.f0)) * n * 1.04
        draw_grid(c, img, F, cx, cy + (0 if c.tall else 40 * u), W * 0.8, H * (0.6 if c.tall else 0.42),
                  lit=lambda i, j: 1.0 if i < math.floor(prog / 1) else 0.12)
        sp = label(c, f"{fmt_day(F['stats']['first'])}  to  {fmt_day(F['stats']['last'])}", 28)
        place(img, sp, cx, cy - (H * 0.36 if c.tall else 290 * u), alpha=min(1, lf / 10))
        if lf >= 48:  # second bar: the name lands on the downbeat
            s, a = slam(lf - 48)
            sp = c.text("Nishal K", 120 * u, 800)
            place(img, sp, cx, cy + (H * 0.36 if c.tall else 330 * u), s, a)
        return img
    if sh.kind == "month":
        (yy, mm), cnt = k["m"]
        name = date(yy, mm, 1).strftime("%b").upper()
        sp = c.text(name, (300 if not k.get("small") else 260) * u, 800)
        place(img, sp, cx, cy - 40 * v)
        place(img, label(c, f"{yy}", 30), cx, cy - 250 * v)
        num = c.text(f"{cnt}", 64 * u, 700, c.g)
        place(img, num, cx, cy + 150 * v)
        place(img, label(c, "contributions", 24), cx, cy + 215 * v)
        return img
    if sh.kind == "count":
        n = k["n"]
        sp = c.text(f"{n}", 360 * u, 800, PAPER)
        place(img, sp, cx, ny)
        place(img, label(c, k.get("label", "contributions"), 30, c.g), cx, cy + 200 * v)
        return img
    if sh.kind == "impact":
        img = Image.new("RGBA", (W, H), c.g + (255,))
        sp = c.text(k["text"], c.fit(k["text"], 520 * u, maxw), 800, INK)
        place(img, sp, cx, ny, 1.08)
        return img
    if sh.kind in ("hero", "final"):
        n = k["n"]
        sp = c.text(f"{n}", c.fit(str(n), 460 * u, maxw), 800, PAPER)
        s, a = (1.0, 1.0) if sh.kind == "hero" else slam(lf)
        place(img, sp, cx, ny, s, a, trail=True)
        place(img, label(c, k.get("label", "contributions"), 34, c.g), cx, cy + 210 * v, alpha=min(1, lf / 3))
        if k.get("sub"):
            place(img, label(c, k["sub"], 24), cx, cy + 268 * v, alpha=min(1, max(0, lf - 6) / 6))
        return img
    if sh.kind == "week":
        w = k["w"]
        d0 = date.fromisoformat(w["start"])
        place(img, label(c, "busiest week", 30, c.g), cx, cy - (520 if c.tall else 330) * u)
        place(img, c.text(f"{fmt_day(d0)}", 76 * u, 760), cx, cy - (440 if c.tall else 250) * u)
        # one column per day, rising on that day's step in the bar (the song plays day d at d/8 of the bar)
        dmax = max(1, max(w["days"]))
        bw, gap = (110 if c.tall else 120) * u, (24 if c.tall else 36) * u
        x0 = cx - (7 * bw + 6 * gap) / 2
        base = cy + (260 if c.tall else 170) * u
        hmax = (520 if c.tall else 330) * u
        d = ImageDraw.Draw(img)
        for i, cnt in enumerate(w["days"]):
            at = i * 6  # an 8th = 6 frames
            p = ease_out((lf - at) / 4) if lf >= at else 0
            hh = max(6 * u, hmax * cnt / dmax) * p
            x = x0 + i * (bw + gap)
            d.rounded_rectangle([x, base - hh, x + bw, base], radius=10 * u, fill=c.g if cnt == dmax else mix(FAINT, PAPER, 0.75) if cnt else FAINT)
            place(img, label(c, "SMTWTFS"[i], 26), x + bw / 2, base + 40 * u)
            if p > 0.5 and cnt:
                place(img, c.text(str(cnt), 40 * u, 700, PAPER), x + bw / 2, base - hh - 34 * u, alpha=min(1, (p - 0.5) * 2))
        place(img, c.text(f"{k['total']}", 120 * u, 800, PAPER), cx, cy + (480 if c.tall else 320) * u)
        if w.get("lang"):
            place(img, label(c, f"contributions  ·  mostly {w['lang']}", 24), cx, cy + (570 if c.tall else 400) * u)
        return img
    if sh.kind in ("stat", "slam"):
        n = k["n"]
        s, a = slam(lf)
        sp = c.text(f"{n}", c.fit(str(n), 400 * u, maxw), 800, PAPER)
        place(img, sp, cx, ny, s, a, trail=True)
        place(img, label(c, k["label"], 36, c.g), cx, cy + 190 * v, alpha=a)
        if k.get("sub"):
            place(img, label(c, k["sub"], 24), cx, cy + 250 * v, alpha=a)
        return img
    if sh.kind == "repo":
        r = k["r"]
        s, a = slam(lf)
        place(img, label(c, f"top repo  {k['rank']:02d}", 28, c.g), cx, cy - 210 * v, alpha=a)
        sp = c.text(r["name"], c.fit(r["name"], 210 * u, maxw), 800)
        place(img, sp, cx, cy - 20 * v, s, a, trail=True)
        bits = [f"{r['commits']} commits"] if r.get("commits") else []
        if r.get("lang"):
            bits.append(r["lang"])
        if bits:
            place(img, label(c, "  ·  ".join(bits), 28), cx, cy + 150 * v, alpha=a)
        if r.get("lang"):
            d = ImageDraw.Draw(img)
            rr = 10 * u
            tw = label(c, "  ·  ".join(bits), 28).width
            x = cx - tw / 2 - 30 * u
            d.ellipse([x - rr, cy + 150 * v - rr, x + rr, cy + 150 * v + rr], fill=lang_color(r["lang"]))
        return img
    if sh.kind == "grid":
        # breather: the whole year, a slow push, the busiest month picked out after the first bar
        hl = k["month"] if lf >= 48 else None
        # a playhead: the column of the week you're hearing (this stretch of the edit plays song bars 34-37),
        # lighting each day on its step in the bar, the way the song plays them
        wk = k["song_bar"] + lf // 48
        step = (lf % 48) / 6
        flare = lambda i, j: (0.55 if i == wk and j <= step else 0.0)
        draw_grid(c, img, F, cx, cy + (0 if c.tall else 10) * u, W * 0.86, H * (0.62 if c.tall else 0.5), highlight_month=hl, flare=flare)
        p = ease_out((lf - 48) / 18) if lf >= 48 else 0
        mname = date(int(k["month"][:4]), int(k["month"][5:]), 1).strftime("%B %Y")
        place(img, label(c, "the year, one square a day", 26), cx, cy - (H * 0.4 if c.tall else 340 * u), alpha=min(1, lf / 14))
        if p:
            place(img, c.text(f"{mname}  ·  {k['month_n']}", 56 * u, 700, PAPER), cx, cy + (H * 0.39 if c.tall else 330 * u), alpha=p)
        return img
    if sh.kind == "langs":
        langs = k["langs"][:5]
        total = sum(x["commits"] for x in langs) or 1
        d = ImageDraw.Draw(img)
        if c.tall:
            # heading, then rows: name left, share right, a bar underneath growing in turn. The block is
            # centred as a whole so the frame isn't top- or bottom-heavy.
            rh, head = 200 * u, 170 * u
            top = cy - (head + len(langs) * rh - 60 * u) / 2
            place(img, label(c, "commits by language", 28, c.g), cx, top)
            y = top + head
            for i, x in enumerate(langs):
                at = i * 15  # one language every 1.25 beats, so the growth fills the two bars
                p = ease_out((lf - at + 3) / 18) if lf >= at else 0
                share = x["commits"] / total
                # names wait dimmed in their rows, so the block is whole (and centred) from the cut
                place(img, c.text(x["name"], 80 * u, 760), W * 0.08, y, alpha=0.28 + 0.72 * p, anchor="lm")
                place(img, c.text(f"{round(share * 100)}%", 64 * u, 650, DIM), W * 0.92, y, alpha=p, anchor="rm")
                bw = (W * 0.84) * share / max(1e-9, langs[0]["commits"] / total) * p
                if p > 0:
                    d.rounded_rectangle([W * 0.08, y + 58 * u, W * 0.08 + max(8 * u, bw), y + 76 * u], radius=9 * u, fill=lang_color(x["name"]))
                y += rh
        else:
            place(img, label(c, "commits by language", 28, c.g), cx, cy - 260 * u)
            # one bar split by language, each part sliding in on its beat, names under it
            bx0, bx1, by = W * 0.1, W * 0.9, cy - 40 * v
            x = bx0
            for i, l in enumerate(langs):
                share = l["commits"] / total
                wpx = (bx1 - bx0) * share
                at = i * 15
                p = ease_out((lf - at + 3) / 16) if lf >= at else 0
                if p:
                    d.rounded_rectangle([x + 3 * u, by, x + max(3 * u, wpx * p) - 3 * u, by + 90 * u], radius=14 * u, fill=lang_color(l["name"]))
                    if wpx > 140 * u:
                        place(img, c.text(l["name"], min(54, wpx / u / 6) * u, 760), x + 8 * u, by + 150 * u, alpha=p, anchor="lm")
                        place(img, label(c, f"{round(share * 100)}%", 26), x + 8 * u, by + 205 * u, alpha=p, anchor="lm")
                x += wpx
        return img
    if sh.kind == "release":
        r = k["r"]
        title = r["title"]
        tag = title.replace(r["repo"], "").strip(" -–:") or title
        sp = c.text(r["repo"], c.fit(r["repo"], 190 * u, maxw), 800)
        place(img, sp, cx, cy - 30 * v)
        place(img, c.text(tag[:36], c.fit(tag[:36], 60 * u, maxw, 600, True), 600, c.g, mono=True), cx, cy + 120 * v)
        place(img, label(c, f"release  ·  {fmt_day(r['date'])}", 24), cx, cy + 195 * v)
        return img
    if sh.kind == "newrepo":
        r = k["r"]
        sp = c.text(r["repo"], c.fit(r["repo"], 200 * u, maxw), 800)
        s = 1 + 0.12 * math.exp(-lf / 1.4)
        place(img, sp, cx, cy - 20 * v, s)
        bits = f"new repo  ·  {fmt_day(r['date'], False)}" + (f"  ·  {r['lang']}" if r.get("lang") else "")
        place(img, label(c, bits, 26), cx, cy + 140 * v)
        if r.get("lang"):
            d = ImageDraw.Draw(img)
            tw = label(c, bits, 26).width
            x, y, rr = cx - tw / 2 - 28 * u, cy + 140 * v, 9 * u
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=lang_color(r["lang"]))
        return img
    if sh.kind == "lightup":
        # the whole grid, each week's column flashing in turn on 16ths, a wave across the year
        n = len(F["weeks"])
        pos = lf / 3 * (n / 24)  # 24 sixteenths to cross the year

        def lit(i, j):
            return 1.0 if pos - i >= 0 else 0.3
        flare = lambda i, j: max(0.0, 1 - abs(pos - i) / 2.2) if pos - i >= -0.5 else 0.0
        draw_grid(c, img, F, cx, cy, W * 0.92, H * (0.7 if c.tall else 0.6), lit=lit, flare=flare)
        return img
    if sh.kind == "outro":
        n_end = sh.f1 - sh.f0
        s_, _ = slam(lf)
        sp = c.text(f"@{HANDLE}", 170 * u, 800)
        place(img, sp, cx, cy - 100 * v, s_, trail=True)
        q = ease_out((lf - 24) / 18) if lf >= 24 else 0
        place(img, c.text(f"github.com/{HANDLE}", 40 * u * (1.3 if c.tall else 1), 500, mix(DIM, PAPER, 0.6), mono=True), cx, cy + 50 * v, alpha=q)
        r = ease_out((lf - 48) / 18) if lf >= 48 else 0
        st = F["stats"]
        recap = f"{st['total']} contributions  ·  {len(F['releases'])} releases  ·  {len(F['created'])} new repos"
        place(img, label(c, recap, 24, c.g), cx, cy + 140 * v, alpha=r)
        s2 = ease_out((lf - 72) / 18) if lf >= 72 else 0
        place(img, label(c, "music: my contribution song, made from the same numbers", 20), cx, cy + 200 * v, alpha=s2)
        fade = max(0.0, min(1.0, (n_end - lf) / (2.0 * FPS)))
        if fade < 1:
            img = Image.blend(Image.new("RGBA", (W, H), INK + (255,)), img, fade)
        return img
    return img


class Edit:
    """Shots plus the camera and flash layer, frame by frame."""

    def __init__(self, song, F, shots, kicks, W, H, length_frames):
        self.song, self.F, self.shots = song, F, shots
        self.c = Canvas(W, H, F["ground"])
        self.n = length_frames
        self.kick_frames = [int(round(t * FPS)) for t in kicks]
        drops = [(6 * 48, 10 * 48), (16 * 48, 22 * 48)]
        self.drop = lambda f: any(a <= f < b for a, b in drops)
        self.after_impact = {s.f1 for s in shots if s.kind == "impact"}

    def shot_at(self, f):
        cur = None
        for s in self.shots:
            if s.f0 <= f < s.f1:
                cur = s  # later shots (overlays like "final") win
        return cur

    def camera(self, f, sh):
        """Zoom and shake. Builds zoom in faster and faster (a speed ramp into the drop); drops kick the
        camera on every low hit; each drop shot lands slightly zoomed and settles."""
        z, dx, dy = 1.0, 0.0, 0.0
        for a, b in ((4 * 48, 6 * 48), (14 * 48, 16 * 48)):
            if a <= f < b:
                p = (f - a) / (b - a)
                z *= 1 + 0.16 * p ** 3
        if 2 * 48 <= f < 4 * 48:
            z *= 1 + 0.05 * ((f - 96) / 96) ** 2
        if 20 * 48 <= f < 21 * 48 + 24:  # the light-up: a push that speeds up into the last slam
            z *= 1 + 0.2 * ((f - 960) / 72) ** 2.2
        if f >= 22 * 48:  # outro: one long, slow push to the end
            z *= 1 + 0.08 * ((f - 22 * 48) / (self.n - 22 * 48)) ** 0.8
        if 10 * 48 <= f < 14 * 48:  # breather: one slow push per shot
            z *= 1 + 0.045 * ((f - 480) % 96) / 96
        if self.drop(f) and sh is not None:
            lf = f - sh.f0
            z *= 1 + 0.07 * math.exp(-lf / 3.5)
            last = max((k for k in self.kick_frames if k <= f), default=None)
            if last is not None and f - last < 8:
                e = math.exp(-(f - last) / 2.0)
                rnd = np.random.default_rng(last)
                ang = rnd.uniform(0, 2 * math.pi)
                amp = 9 * self.c.u * e
                dx, dy = amp * math.cos(ang), amp * math.sin(ang)
                z *= 1 + 0.018 * e
        return z, dx, dy

    def flash(self, f, sh):
        if sh is None or not self.drop(f):
            return 0.0
        lf = f - sh.f0
        if sh.kind == "impact" or sh.f0 not in self.after_impact:
            return 0.0
        return 0.12 if lf == 0 else 0.0

    def frame(self, f):
        sh = self.shot_at(f)
        if sh is None:
            return Image.new("RGB", (self.c.W, self.c.H), INK)
        img = draw_shot(self.c, sh, f, self.F, self.song)
        z, dx, dy = self.camera(f, sh)
        W, H = self.c.W, self.c.H
        if abs(z - 1) > 1e-4 or dx or dy:
            # inverse map: output (x, y) samples input ((x - W/2 - dx) / z + W/2, ...)
            a = 1 / z
            img = img.transform((W, H), Image.AFFINE, (a, 0, W / 2 - (W / 2 + dx) * a, 0, a, H / 2 - (H / 2 + dy) * a),
                                resample=Image.BILINEAR, fillcolor=INK + (255,))
        fl = self.flash(f, sh)
        if fl:  # the impact frame's colour, decaying into the next shot
            img = Image.blend(img, Image.new("RGBA", (W, H), self.c.g + (255,)), fl)
        return img.convert("RGB")


_EDIT = None


def _init(args):
    global _EDIT
    _EDIT = Edit(*args)


def _render(f):
    return _EDIT.frame(f).tobytes()


def render(song, F, shots, kicks, audio_wav, out, W, H, n_frames, workers):
    from multiprocessing import get_context
    enc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", str(audio_wav), "-c:v", "libx264", "-preset", "medium", "-tune", "animation", "-crf", "21", "-pix_fmt", "yuv420p",
         "-profile:v", "high", "-g", str(FPS * 2), "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    args = (song, F, shots, kicks, W, H, n_frames)
    if workers > 1:
        with get_context("fork").Pool(workers, _init, (args,)) as pool:
            for buf in pool.imap(_render, range(n_frames), chunksize=6):
                enc.stdin.write(buf)
    else:
        _init(args)
        for f in range(n_frames):
            enc.stdin.write(_render(f))
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit("ffmpeg failed")


def write_wav(path, x):
    import wave
    x = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x.T * 32767).astype(np.int16).tobytes())


def video(out_dir, site, only=None):
    out_dir, site = Path(out_dir), Path(site)
    out_dir.mkdir(parents=True, exist_ok=True)
    song = load_song(site)
    F = year_facts(song)
    x = decode(site / "contribution-song.mp3")
    y, starts = cut_audio(song, x)
    n_frames = int(round(y.shape[1] / SR * FPS))
    y = y[:, :int(n_frames / FPS * SR)]
    kicks = kick_onsets(y, song["bar"])
    shots = plan(song, F, site)
    y, events = score(song, site, shots, y.shape[1])
    wav = out_dir / "trailer-audio.wav"
    write_wav(wav, y)
    workers = max(1, min(4, (os.cpu_count() or 2)))
    import time
    for name, W, H in (("trailer.mp4", 1920, 1080), ("trailer-vertical.mp4", 1080, 1920)):
        if only and (only == "wide") != (W > H):
            continue
        t0 = time.time()
        render(song, F, shots, kicks, wav, out_dir / name, W, H, n_frames, workers)
        print(f"{name}: {n_frames} frames in {time.time() - t0:.0f}s, {os.path.getsize(out_dir / name) / 1048576:.1f} MB")
    wav.unlink()
    # poster for the video page: the first drop's hero frame
    e = Edit(song, F, shots, kicks, 1920, 1080, n_frames)
    e.frame(6 * 48 + 20).resize((960, 540), Image.LANCZOS).save(out_dir / "trailer-poster.jpg", quality=86)
    # cut points: where a new shot starts (the shot that follows an impact frame is part of that hit)
    after = {s.f1 for s in shots if s.kind == "impact"}
    cuts = sorted({s.f0 for s in shots if s.f0 > 0 and s.f0 not in after})
    meta = dict(fps=FPS, bpm=song["bpm"], bar=song["bar"], frames=n_frames, length=round(n_frames / FPS, 3),
                splices=[round(s, 4) for s in starts], cuts=[c / FPS for c in cuts], shots=len(shots),
                kicks=kicks, hits=[[round(t, 4), e] for t, e in events], generated=song.get("generated"),
                sections=[dict(t=round(b * 48 / FPS, 3), title=name) for b, name in SECTIONS if b * 48 < n_frames])
    (out_dir / "trailer.json").write_text(json.dumps(meta))
    print(f"trailer: {len(shots)} shots, {len(cuts)} cuts, {n_frames / FPS:.1f}s")


# ---------- README card ----------

def poster(song):
    """A card in the same style as the other README cards: the edit drawn as a timeline, one tick per cut."""
    F = year_facts(song)
    shots = plan(song, F, ROOT / "assets")
    bar = song["bar"]
    total_bars = sum(nb for _, nb in EDIT if nb) + 1
    length = total_bars * bar + 2.0
    secs = [("Intro", 0, 4), ("Build", 4, 2), ("Drop", 6, 4), ("Breather", 10, 4), ("Build", 14, 2), ("Drop", 16, 6), ("Outro", 22, 3)]
    W, H = 495, 195
    out = {}
    for name, t in THEMES.items():
        s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
             f'aria-label="Year trailer: {len(shots)} shots cut to the contribution song">',
             f'<title>Year trailer: {len(shots)} shots cut to the contribution song</title>',
             f'<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="4.5" fill="{t["bg"]}" stroke="{t["border"]}"/>',
             f'<text x="25" y="35" font-family="{CARD_FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Year trailer</text>',
             f'<text x="{W - 25}" y="34" text-anchor="end" font-family="{CARD_FONT}" font-size="11" fill="{t["muted"]}">'
             f'{int(length // 60)}:{int(length % 60):02d} · {len(shots)} shots · cut on the beat</text>']
        x0, x1 = 25, W - 25
        sx = lambda b: x0 + (x1 - x0) * b * bar / length
        # the numbers it shows, big
        st = song["stats"]
        bits = [(str(st["total"]), "contributions"), (str(len(F["releases"])), "releases"), (str(len(F["created"])), "new repos")]
        if F["prs"] is not None:
            bits.append((str(F["prs"]), "merged PRs"))
        cw = (x1 - x0) / len(bits)
        for i, (v, lab) in enumerate(bits):
            s.append(f'<text x="{x0 + i * cw:.1f}" y="78" font-family="{CARD_FONT}" font-size="28" font-weight="700" fill="{t["text"]}">{esc(v)}</text>')
            s.append(f'<text x="{x0 + i * cw:.1f}" y="96" font-family="{CARD_FONT}" font-size="11" fill="{t["muted"]}">{esc(lab)}</text>')
        # timeline: sections as blocks, a tick at every cut (taller on the drops)
        ty = 120
        for nm, b0, nb in secs:
            a, b = sx(b0), sx(b0 + nb)
            drop = nm == "Drop"
            s.append(f'<rect x="{a:.1f}" y="{ty}" width="{b - a - 2:.1f}" height="22" rx="3" fill="{t["icon"] if drop else t["faint"]}" fill-opacity="{0.22 if drop else 1}"/>')
            if b - a > 34:
                s.append(f'<text x="{a + 4:.1f}" y="{ty + 36}" font-family="{CARD_FONT}" font-size="9.5" fill="{t["muted"]}">{nm}</text>')
        for sh in shots:
            tb = sh.f0 / 48
            if tb <= 0:
                continue
            xx = sx(tb)
            drop = 6 <= tb < 10 or 16 <= tb < 22
            s.append(f'<rect x="{xx - 0.5:.1f}" y="{ty + (2 if drop else 6)}" width="1" height="{18 if drop else 10}" fill="{t["icon"] if drop else t["muted"]}"/>')
        s.append(f'<text x="25" y="{H - 18}" font-family="{CARD_FONT}" font-size="11.5" fill="{t["text"]}"><tspan font-weight="700">▶ Watch</tspan> · '
                 f'rebuilt every night from the same data as the song</text>')
        s.append(f'<text x="{W - 25}" y="{H - 18}" text-anchor="end" font-family="{CARD_FONT}" font-size="10" fill="{t["muted"]}">{song["bpm"]} BPM · 28 fps</text>')
        s.append("</svg>\n")
        out[name] = "\n".join(s)
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("video", "poster"):
        sys.exit(__doc__)
    if sys.argv[1] == "poster":
        song = json.loads(Path(ASSETS, "contribution-song.json").read_text())
        for name, svg in poster(song).items():
            write_atomic(os.path.join(ASSETS, f"trailer-{name}.svg"), svg)
        print("trailer cards written")
        return
    args = sys.argv[2:]
    out = args[0] if args and not args[0].startswith("--") else "_site/video"
    site = args[args.index("--site") + 1] if "--site" in args else "_site/player"
    only = args[args.index("--only") + 1] if "--only" in args else None
    video(out, site, only)


if __name__ == "__main__":
    main()
