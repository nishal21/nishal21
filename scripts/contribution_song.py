"""Contribution song: the last 12 months of contributions turned into a ~90 second track with vocals.

Arrangement: 53 bars at 140 BPM (half-time feel), one bar per week of the calendar, in order.
  intro 4 | verse 14 | chorus 8 | verse 14 | chorus 8 | outro 5
Per bar:
  drums  - a section groove that thins out on quiet weeks, plus one hit per day using the
           commit-beat rules (kick 1+, hat 3+, snare 6+, clap 10+), louder on busier days
  bass   - 808 on the chord root; more notes and a higher octave on busier weeks
  chords - A minor pad (Am F C G, chorus F G Em Am)
  melody - A minor pentatonic plucks; note count and register follow the week's total;
           silent weeks get no melody
Vocals: lyrics filled from the real stats, spoken in rhythm by Piper TTS (offline voice
model, downloaded once). Chorus lines also go through a vocoder tuned to the chords, so
they are "sung" on pitch. Output: MP3, lyrics with timestamps, and a dark/light card.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date, datetime, timezone

import numpy as np
from scipy import signal

from common import (ASSETS, CARD_H, CARD_W, FONT, THEMES, USER, card_open, contribution_calendar, esc, fail,
                    gh_api, write_atomic)

SR = 44100
BPM = 140
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BAR / 16
SECTIONS = [("Intro", 4), ("Verse 1", 14), ("Chorus", 8), ("Verse 2", 14), ("Chorus", 8), ("Outro", 5)]
VOICE = os.environ.get("PIPER_VOICE", "en_US-ryan-medium")
VOICE_DIR = os.environ.get("PIPER_VOICE_DIR", os.path.expanduser("~/.cache/piper-voices"))
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/"
RULES = [("kick", 1), ("hat", 3), ("snare", 6), ("clap", 10)]

A4 = 440.0
def hz(midi):
    return A4 * 2 ** ((midi - 69) / 12)

# chord roots/tones as MIDI notes (A minor)
CHORDS = {"Am": [57, 60, 64], "F": [53, 57, 60], "C": [48, 52, 55], "G": [55, 59, 62], "Em": [52, 55, 59]}
VERSE_PROG = ["Am", "F", "C", "G"]
CHORUS_PROG = ["F", "G", "Em", "Am"]
PENTA = [57, 60, 62, 64, 67]  # A C D E G
HOOK = [(0, 4), (3, 3), (6, 1), (8, 0), (11, 1), (14, 3)]  # (step, index into PENTA) for the chorus hook


# ---------- data ----------

def weeks_from_calendar(cal):
    days = sorted(cal)
    n = len(days) // 7 * 7
    days = days[-n:]
    return [[(d, cal[d]) for d in days[i:i + 7]] for i in range(0, n, 7)]


def stats(cal):
    from year_card import stats as year_stats
    return year_stats(cal)


def repo_facts():
    try:
        repos = gh_api(f"/users/{USER}/repos?sort=pushed&per_page=100&type=owner")
    except Exception as e:
        print(f"repo list unavailable ({e}); lyrics will skip repo names")
        return None
    own = [r for r in repos if not r["fork"] and not r["archived"] and r["name"] != USER]
    langs = {}
    for r in own:
        if r["language"]:
            langs[r["language"]] = langs.get(r["language"], 0) + 1
    top_langs = sorted(langs, key=lambda k: -langs[k])
    return dict(recent=[r["name"] for r in own[:3]], n_own=len(own), langs=top_langs[:2])


# ---------- lyrics ----------

ORD = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth", 20: "twentieth",
       30: "thirtieth"}
ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty"]


def ordinal_words(n):
    if n in ORD:
        return ORD[n]
    if n < 20:
        return ONES[n] + "th"
    t, o = divmod(n, 10)
    return TENS[t] + ("-" + ordinal_words(o) if o else "ieth")


SAY = {"upi": "You P I", "cli": "C L I", "amv": "A M V", "ui": "U I", "api": "A P I", "v2": "V two"}


def say_name(name):
    """How a repo name should be pronounced: split on - and _ and CamelCase, spell known acronyms."""
    import re
    parts = re.split(r"[-_. ]+", name)
    out = []
    for p in parts:
        for w in re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", p) or [p]:
            out.append(SAY.get(w.lower(), w))
    return " ".join(out)


def build_lyrics(s, facts):
    """Return [(section, [(display_line, spoken_line), ...])] using only real stats."""
    month = date(*s["month"], 1).strftime("%B")
    a, b = s["lstart"], s["lend"]
    best = s["best"]
    rest = s["n"] - s["active"]
    L = lambda d, sp=None: (d, sp or d)
    intro = [L(f"{USER}, last twelve months, every week one bar", f"Nishal. Last twelve months. Every week, one bar.")]
    v1 = [
        L(f"{s['total']} contributions since {s['first']:%B %Y}"),
        L(f"{s['active']} days on the board, {rest} days off the grid"),
        L(f"Best day hit {s['best_n']} on {best:%B} {best.day}",
          f"Best day hit {s['best_n']} on {best:%B} {ordinal_words(best.day)}"),
        L(f"{s['best_n']} in a day, the keyboard needed a break"),
        L(f"{month} ran hot with {s['month_n']} on the sheet"),
        L(f"{s['longest']} days straight, that's the longest streak"),
        L(f"{a:%B} {a.day} to {b:%B} {b.day}, I didn't skip a beat",
          f"{a:%B} {ordinal_words(a.day)} to {b:%B} {ordinal_words(b.day)}, I didn't skip a beat"),
    ]
    chorus = [
        L("Push it to main, let the green squares show"),
        L("Every week's a bar, every day's a note"),
        L(f"{s['total']} hits and the loop won't stop"),
        L("Build it, ship it, take it from the top"),
    ]
    if facts and len(facts["recent"]) >= 3 and len(facts["langs"]) >= 2:
        r = facts["recent"]
        v2 = [
            L(f"Right now I'm deep in {r[0]}, {r[1]} and {r[2]}",
              f"Right now I'm deep in {say_name(r[0])}, {say_name(r[1])}, and {say_name(r[2])}"),
            L(f"{facts['n_own']} repos of my own, mostly {facts['langs'][0]} and {facts['langs'][1]}"),
            L(f"Last push went to {r[0]}, the log is still warm", f"Last push went to {say_name(r[0])}, the log is still warm"),
        ]
    else:
        v2 = [L("Every repo on the list got a little bit of time"), L("Commit by commit, line after line"),
              L("The log is still warm from the last push")]
    v2 += [
        L("Cut it like an AMV, every frame on time"),
        L("Mix it like a mashup, every verse in rhyme"),
        L("Quiet weeks play soft, busy weeks get loud"),
        L("That's the whole year, played back to the crowd"),
    ]
    outro = [L(f"That was {s['total']} contributions from {USER}", f"That was {s['total']} contributions from Nishal."),
             L("Tomorrow the numbers change, and the song does too")]
    return [("Intro", intro), ("Verse 1", v1), ("Chorus", chorus), ("Verse 2", v2), ("Chorus", chorus), ("Outro", outro)]


# ---------- synthesis helpers ----------

RNG = np.random.default_rng(140)


def env(n, decay):
    return np.exp(-np.arange(n) / (SR * decay))


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def kick(vel=1.0, length=0.45):
    n = int(SR * length)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.16)
    x[:200] += np.linspace(0.6, 0, 200) * RNG.uniform(-1, 1, 200)
    return vel * np.tanh(1.6 * x)


def snare(vel=1.0):
    n = int(SR * 0.22)
    t = np.arange(n) / SR
    noise = signal.sosfilt(sos("highpass", 1500), RNG.uniform(-1, 1, n))
    return vel * (0.8 * noise * env(n, 0.06) + 0.5 * np.sin(2 * np.pi * 185 * t) * env(n, 0.04))


def clap(vel=1.0):
    n = int(SR * 0.3)
    x = signal.sosfilt(sos("bandpass", [900, 5000]), RNG.uniform(-1, 1, n))
    e = np.zeros(n)
    for off in (0, 0.011, 0.022):
        s0 = int(off * SR)
        e[s0:] += env(n - s0, 0.007 if off < 0.022 else 0.09)
    return vel * 0.9 * x * e


def hat(vel=1.0, open_=False):
    n = int(SR * (0.25 if open_ else 0.05))
    x = signal.sosfilt(sos("highpass", 7000), RNG.uniform(-1, 1, n))
    return vel * 0.5 * x * env(n, 0.08 if open_ else 0.012)


def saw(freq, n, detune=0.0):
    t = np.arange(n) / SR
    ph = (t * freq * (1 + detune)) % 1.0
    return 2 * ph - 1


def add(buf, x, start):
    s = int(round(start * SR))
    if s >= len(buf):
        return
    e = min(len(buf), s + len(x))
    buf[s:e] += x[:e - s]


def compress(x, thr_db=-18, ratio=3.0, win=0.01):
    k = max(1, int(SR * win))
    rms = np.sqrt(np.convolve(x ** 2, np.ones(k) / k, mode="same") + 1e-9)
    thr = 10 ** (thr_db / 20)
    gain = np.where(rms > thr, (rms / thr) ** (1 / ratio - 1), 1.0)
    gain = np.convolve(gain, np.ones(k * 3) / (k * 3), mode="same")
    return x * gain


def reverb_ir(seconds=1.4, decay=0.35, seed=1):
    r = np.random.default_rng(seed)
    n = int(SR * seconds)
    ir = r.uniform(-1, 1, n) * env(n, decay)
    ir = signal.sosfilt(sos("lowpass", 5000), ir)
    ir[0] = 0
    return ir / np.sqrt(np.sum(ir ** 2))


def reverb(x, wet):
    out = []
    for seed in (1, 2):
        out.append(x * (1 - wet) + wet * signal.fftconvolve(x, reverb_ir(seed=seed))[:len(x)])
    return np.stack(out)


# ---------- arrangement ----------

def bar_sections():
    out = []
    for name, n in SECTIONS:
        out += [name] * n
    return out


def instrumental(weeks):
    nbars = len(weeks)
    total = int(SR * (nbars * BAR + 3))
    drums, bass, pad, lead = (np.zeros(total) for _ in range(4))
    pad_r = np.zeros(total)
    secs = bar_sections()
    wk_tot = [sum(c for _, c in w) for w in weeks]
    wmax = max(wk_tot) or 1
    dmax = max(c for w in weeks for _, c in w) or 1
    for i, week in enumerate(weeks):
        sec = secs[i] if i < len(secs) else "Outro"
        t0 = i * BAR
        w = wk_tot[i] / wmax
        chorus = sec == "Chorus"
        prog = CHORUS_PROG if chorus else VERSE_PROG
        chord = CHORDS[prog[i % 4]]
        full = sec.startswith("Verse") or chorus
        # groove
        if full:
            kicks = [0] + ([10] if w > 0.15 or chorus else []) + ([7] if w > 0.5 else []) + ([3] if chorus and w > 0.3 else [])
            for st in kicks:
                add(drums, kick(0.9), t0 + st * STEP)
            add(drums, snare(0.7), t0 + 8 * STEP)
            if chorus:
                add(drums, clap(0.6), t0 + 8 * STEP)
            hat_steps = range(0, 16, 1 if w > 0.5 else 2) if wk_tot[i] else range(0, 16, 4)
            for st in hat_steps:
                add(drums, hat(0.35 if st % 4 else 0.5), t0 + st * STEP)
            if w > 0.75:  # roll into the next bar
                for k in range(6):
                    add(drums, hat(0.3), t0 + 14 * STEP + k * STEP / 3)
        elif sec == "Intro" and i >= 2:
            for st in range(0, 16, 4):
                add(drums, hat(0.3), t0 + st * STEP)
        # one hit per day from the commit-beat rules
        for d, (_, c) in enumerate(week):
            if not c:
                continue
            v = 0.25 + 0.5 * c / dmax
            st = t0 + 2 * d * STEP
            for name, need in RULES:
                if c >= need:
                    x = {"kick": lambda: kick(v * 0.6, 0.25), "hat": lambda: hat(v, open_=True),
                         "snare": lambda: snare(v * 0.7), "clap": lambda: clap(v * 0.8)}[name]()
                    add(drums, x, st)
        # 808 bass on the groove kicks, octave up on busy weeks
        if full or sec == "Outro" and i < len(weeks) - 2:
            root = chord[0] - 24 + (12 if w > 0.6 else 0)
            notes = [0, 10] if w <= 0.3 else [0, 7, 10]
            for k, st in enumerate(notes):
                length = (notes[k + 1] - st if k + 1 < len(notes) else 16 - st) * STEP
                n = int(SR * length)
                t = np.arange(n) / SR
                x = np.tanh(2.2 * np.sin(2 * np.pi * hz(root) * t)) * np.minimum(1, (n - np.arange(n)) / (SR * 0.02))
                add(bass, 0.55 * x * env(n, 0.9), t0 + st * STEP)
        # pad
        n = int(SR * BAR)
        att = np.minimum(1, np.arange(n) / (SR * 0.25)) * np.minimum(1, (n - np.arange(n)) / (SR * 0.1))
        lvl = {"Intro": 0.5, "Outro": 0.45, "Chorus": 0.42}.get(sec, 0.3)
        for note in chord:
            add(pad, lvl * att * saw(hz(note), n, 0.003) / 3, t0)
            add(pad_r, lvl * att * saw(hz(note), n, -0.003) / 3, t0)
        # melody
        r = np.random.default_rng(1000 + i)
        if chorus:
            steps = [(st, PENTA[k]) for st, k in HOOK]
        elif wk_tot[i]:
            count = 2 + int(round(6 * w))
            pos = sorted(r.choice(np.arange(0, 16, 2), size=min(8, count), replace=False))
            steps = [(int(st), int(r.choice(PENTA))) for st in pos]
        else:
            steps = []
        octave = 12 if (w > 0.5 or chorus) else 0
        for st, note in steps:
            n = int(SR * 0.35)
            t = np.arange(n) / SR
            f = hz(note + octave)
            x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env(n, 0.12)
            add(lead, (0.3 + 0.2 * w) * x, t0 + st * STEP)
    pad = signal.sosfilt(sos("lowpass", 1800), pad)
    pad_r = signal.sosfilt(sos("lowpass", 1800), pad_r)
    bass = signal.sosfilt(sos("lowpass", 400), bass)
    lead_st = reverb(lead, 0.3)
    left = 0.9 * drums + 0.8 * bass + 0.6 * pad + 0.5 * lead_st[0]
    right = 0.9 * drums + 0.8 * bass + 0.6 * pad_r + 0.5 * lead_st[1]
    return np.stack([left, right]), wk_tot


# ---------- vocals ----------

def ensure_voice():
    path = os.path.join(VOICE_DIR, VOICE + ".onnx")
    if not os.path.exists(path):
        os.makedirs(VOICE_DIR, exist_ok=True)
        for ext in (".onnx", ".onnx.json"):
            urllib.request.urlretrieve(VOICE_URL + VOICE + ext, os.path.join(VOICE_DIR, VOICE + ext))
    return path


def tts(voice, text, speed):
    from piper import SynthesisConfig
    cfg = SynthesisConfig(length_scale=speed, noise_scale=0.6, noise_w_scale=0.7)
    audio = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)])
    audio = signal.resample_poly(audio, SR, voice.config.sample_rate)
    idx = np.where(np.abs(audio) > 0.02)[0]  # trim silence
    return audio[idx[0]:idx[-1] + 1] if len(idx) else audio


def fit_line(voice, text, window):
    """Speak a line so it fills ~90% of its window; speed it up or slow it down within natural limits."""
    x = tts(voice, text, 1.0)
    target = 0.9 * window
    scale = float(np.clip(target / (len(x) / SR), 0.72, 1.15))
    if abs(scale - 1) > 0.03:
        x = tts(voice, text, scale)
    if len(x) / SR > window * 0.97:  # still too long: squeeze with ffmpeg's tempo filter (keeps pitch)
        x = atempo(x, (len(x) / SR) / (window * 0.95))
    return x


def atempo(x, factor):
    import wave
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.wav"), os.path.join(d, "b.wav")
        write_wav(a, x[None, :])
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", a, "-filter:a", f"atempo={factor:.4f}", b], check=True)
        with wave.open(b) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32767


def vocoder(speech, chord_notes_per_bar, start_bar):
    """Classic channel vocoder: the speech's spectral envelope shapes a saw-chord carrier."""
    n = len(speech)
    carrier = np.zeros(n)
    t = np.arange(n) / SR
    for k, notes in enumerate(chord_notes_per_bar):
        s0, s1 = int(k * BAR * SR), min(n, int((k + 1) * BAR * SR))
        if s0 >= n:
            break
        for note in notes:
            carrier[s0:s1] += saw(hz(note), s1 - s0, 0.002) / len(notes)
    nper = 1024
    _, _, S = signal.stft(speech, fs=SR, nperseg=nper)
    _, _, C = signal.stft(carrier, fs=SR, nperseg=nper)
    _, _, N = signal.stft(RNG.uniform(-1, 1, n), fs=SR, nperseg=nper)
    smooth = lambda M, k: signal.convolve2d(np.abs(M), np.ones((k, 1)) / k, mode="same")
    env_s = smooth(S, 7)
    env_c = smooth(C, 15) + 1e-6
    env_n = smooth(N, 15) + 1e-6
    freqs = np.fft.rfftfreq(nper, 1 / SR)[:, None]
    hf = np.clip((freqs - 3500) / 2000, 0, 1)
    Y = C / env_c * env_s + 0.35 * hf * N / env_n * env_s
    _, y = signal.istft(Y, fs=SR, nperseg=nper)
    y = y[:n]
    return y / (np.max(np.abs(y)) + 1e-9) * np.max(np.abs(speech))


def vocals(lyrics, total_len):
    from piper import PiperVoice
    voice = PiperVoice.load(ensure_voice())
    dry = np.zeros(total_len)
    voc = np.zeros(total_len)
    timeline = []
    bar = 0
    for (name, nbars), (_, lines) in zip(SECTIONS, lyrics):
        per = nbars // len(lines) if lines else nbars
        per = max(1, min(per, 4))
        for j, (display, spoken) in enumerate(lines):
            b = bar + j * per
            if name == "Intro":
                b = bar + 1
            start = b * BAR + STEP * 0.5
            window = per * BAR - STEP if name not in ("Intro", "Outro") else min(per, 2) * BAR + BAR
            x = fit_line(voice, spoken, window)
            x = signal.sosfilt(sos("highpass", 110), x)
            add(dry, x, start)
            if name == "Chorus":
                prog = CHORUS_PROG
                notes = []
                for k in range(per + 1):
                    ch = CHORDS[prog[(b + k) % 4]]
                    notes.append([ch[0] - 12, ch[1] - 12, ch[2] - 12, ch[0]])
                add(voc, vocoder(x, notes, b), start)
            timeline.append(dict(section=name, start=start, end=start + len(x) / SR, text=display))
        bar += nbars
    dry = compress(dry / (np.max(np.abs(dry)) + 1e-9), -20, 3.5)
    voc = compress(voc / (np.max(np.abs(voc)) + 1e-9), -20, 3.0) if np.any(voc) else voc
    return dry, voc, timeline


# ---------- output ----------

def write_wav(path, stereo):
    import wave
    x = np.clip(stereo, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x.T * 32767).astype(np.int16).tobytes())


def mix(inst, dry, voc):
    # duck the instrumental a little under the vocal
    k = int(SR * 0.05)
    venv = np.convolve(np.abs(dry), np.ones(k) / k, mode="same")
    duck = 1 - 0.35 * np.clip(venv / (np.max(venv) + 1e-9) * 3, 0, 1)
    inst = inst / (np.max(np.abs(inst)) + 1e-9) * 0.55 * duck
    dry_v = reverb(dry, 0.12)
    voc_v = reverb(voc, 0.3)
    has_voc = np.convolve(np.abs(voc), np.ones(k) / k, mode="same") > 1e-3
    dry_gain = np.where(has_voc, 0.45, 0.8)  # in the chorus the vocoder leads, dry sits behind it
    out = inst + dry_v * dry_gain * 0.9 + voc_v * 0.75
    out = np.tanh(1.1 * out) / np.tanh(1.1)
    return out / (np.max(np.abs(out)) + 1e-9) * 0.95


def encode_mp3(stereo, path):
    with tempfile.TemporaryDirectory() as d:
        wav, mp3 = os.path.join(d, "s.wav"), os.path.join(d, "s.mp3")
        write_wav(wav, stereo)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
                        "-ar", str(SR), "-codec:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1",
                        "-fflags", "+bitexact", "-flags:a", "+bitexact", mp3], check=True)
        with open(mp3, "rb") as f:
            write_atomic(path, f.read())


def mmss(sec):
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def lyrics_md(timeline, s, length):
    out = [f"# Contribution song", "",
           f"{mmss(length)} · {BPM} BPM · A minor · {s['total']} contributions from "
           f"{s['first']:%b %-d, %Y} to {s['last']:%b %-d, %Y}", "",
           "Every bar is one week of my GitHub contribution calendar, in order. Drums come from the daily counts, "
           "and busier weeks get more bass and melody notes. The lyrics are filled in from the same numbers and the "
           "whole thing is rebuilt every night by a GitHub Action.", ""]
    cur = None
    for line in timeline:
        if line["section"] != cur:
            cur = line["section"]
            out += ["", f"## {cur}", ""]
        out.append(f"`{mmss(line['start'])}` {line['text']}  ")
    out += ["", "[Play it in the browser](https://nishal21.github.io/nishal21/player/) or "
            "[download the MP3](https://nishal21.github.io/nishal21/player/contribution-song.mp3).", ""]
    return "\n".join(out).replace("\n\n\n", "\n\n")


def lrc(timeline, s):
    out = [f"[ti:Contribution song]", f"[ar:Nishal K]", f"[al:{s['total']} contributions]"]
    for l in timeline:
        m, sec = divmod(l["start"], 60)
        out.append(f"[{int(m):02d}:{sec:05.2f}]{l['text']}")
    return "\n".join(out) + "\n"


def song_json(s, facts, weeks, timeline, length, song):
    """Everything the player page needs: timing, lyrics, stats, the weekly grid and a waveform."""
    acc, sections = 0, []
    for name, nb in SECTIONS:
        sections.append(dict(name=name, start=round(acc * BAR, 3), bars=nb))
        acc += nb
    data = dict(
        title="Contribution song", artist="Nishal K", length=round(length, 3), bpm=BPM, key="A minor",
        bar=round(BAR, 6), generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        rules=[dict(name=n, min=m) for n, m in RULES], sections=sections,
        stats=dict(total=s["total"], active=s["active"], days=s["n"], first=str(s["first"]), last=str(s["last"]),
                   best=str(s["best"]), best_n=s["best_n"], month=f"{s['month'][0]}-{s['month'][1]:02d}",
                   month_n=s["month_n"], streak=s["longest"], streak_start=str(s["lstart"]), streak_end=str(s["lend"]),
                   recent=(facts or {}).get("recent", []), langs=(facts or {}).get("langs", [])),
        weeks=[dict(start=str(w[0][0]) if w else None, days=[c for _, c in w]) for w in weeks],
        lines=[dict(t=round(l["start"], 3), end=round(l["end"], 3), section=l["section"], text=l["text"])
               for l in timeline],
        peaks=[round(float(p), 3) for p in peaks(song, 400)])
    return json.dumps(data, separators=(",", ":"))


def peaks(stereo, n):
    mono = np.abs(stereo).mean(0)
    chunks = np.array_split(mono, n)
    p = np.array([np.sqrt(np.mean(c ** 2)) for c in chunks])
    return p / (p.max() + 1e-9)


SEC_COLORS = {"Intro": "muted", "Verse 1": "text", "Chorus": "icon", "Verse 2": "text", "Outro": "muted"}


def render_card(s, length, wave_peaks, t):
    w, h = CARD_W, CARD_H
    label = f"Contribution song · {mmss(length)} · {s['total']} contributions"
    out = [card_open(t, label=label)]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Contribution song</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{BPM} BPM · A minor · 1 bar = 1 week</text>')
    x0, x1, mid, amp = 25, w - 25, 92, 34
    n = len(wave_peaks)
    bw = (x1 - x0) / n
    song_bars = sum(nb for _, nb in SECTIONS)
    edges, acc = [], 0
    for name, nb in SECTIONS:
        edges.append((name, acc * BAR / length, (acc + nb) * BAR / length))
        acc += nb
    def color_at(frac):
        for name, a, b in edges:
            if a <= frac < b:
                return t[SEC_COLORS[name]]
        return t["muted"]
    for i, p in enumerate(wave_peaks):
        hh = max(1.5, amp * p)
        out.append(f'<rect x="{x0 + i*bw:.1f}" y="{mid - hh:.1f}" width="{max(1, bw - 1.2):.1f}" height="{2*hh:.1f}" rx="1" fill="{color_at((i + 0.5) / n)}" fill-opacity="{0.45 + 0.55*p:.2f}"/>')
    # section strip
    for name, a, b in edges:
        xa, xb = x0 + a * (x1 - x0), x0 + min(b, 1) * (x1 - x0)
        out.append(f'<rect x="{xa:.1f}" y="136" width="{xb - xa - 2:.1f}" height="3" rx="1.5" fill="{t[SEC_COLORS[name]]}" fill-opacity="0.8"/>')
        short = name.replace("Verse ", "V").replace("Chorus", "Chorus").replace("Intro", "In").replace("Outro", "Out")
        out.append(f'<text x="{(xa + xb) / 2:.1f}" y="152" text-anchor="middle" font-family="{FONT}" font-size="10" fill="{t["muted"]}">{esc(short)}</text>')
    out.append(f'<text x="25" y="{h-18}" font-family="{FONT}" font-size="11.5" fill="{t["text"]}"><tspan font-weight="700">{mmss(length)}</tspan> · {s["total"]} contributions · {len(SECTIONS)} sections</text>')
    out.append(f'<text x="{w-25}" y="{h-18}" text-anchor="end" font-family="{FONT}" font-size="10" fill="{t["muted"]}">vocals: Piper TTS + vocoder</text>')
    out.append("</svg>\n")
    return "\n".join(out)


def main():
    if not shutil.which("ffmpeg"):
        fail("ffmpeg not found")
    try:
        cal = contribution_calendar()
        s = stats(cal)
        weeks = weeks_from_calendar(cal)
        if len(weeks) != sum(n for _, n in SECTIONS):
            # arrangement expects 53 bars; pad or trim the oldest weeks if GitHub returns a different span
            target = sum(n for _, n in SECTIONS)
            weeks = ([[]] * max(0, target - len(weeks)) + weeks)[-target:]
        facts = repo_facts()
        lyrics = build_lyrics(s, facts)
        inst, _ = instrumental(weeks)
        dry, voc, timeline = vocals(lyrics, inst.shape[1])
        song = mix(inst, dry, voc)
        length = len(weeks) * BAR + 2.0
        song = song[:, :int(SR * length)]
        fade = int(SR * 1.5)
        song[:, -fade:] *= np.linspace(1, 0, fade)
    except Exception as e:
        import traceback
        traceback.print_exc()
        fail(f"song failed: {e}")
    encode_mp3(song, os.path.join(ASSETS, "contribution-song.mp3"))
    write_atomic(os.path.join(ASSETS, "contribution-song-lyrics.md"), lyrics_md(timeline, s, length))
    wp = peaks(song, 96)
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"song-{name}.svg"), render_card(s, length, wp, t))
    write_atomic(os.path.join(ASSETS, "contribution-song.lrc"), lrc(timeline, s))
    write_atomic(os.path.join(ASSETS, "contribution-song.json"), song_json(s, facts, weeks, timeline, length, song))
    print(f"song: {mmss(length)} ({length:.1f}s), {len(weeks)} bars, {len(timeline)} vocal lines")


if __name__ == "__main__":
    main()
