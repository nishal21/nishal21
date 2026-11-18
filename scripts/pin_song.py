"""Pin a finished take (made outside the nightly job, e.g. on Runware) as one style of the contribution song.

  python3 scripts/pin_song.py <original|acoustic> <take.mp3> --sheet <lyrics sheet> [--engine "Runware · MiniMax Music 2.6"]
                              [--bpm-hint 110] [--key "A minor"]

The sheet is the exact lyrics the take was made from ([Section] headers, one line per row). Whisper (faster-whisper,
word timestamps) listens to the take, its words are matched to the sheet in order, and each sheet line gets the time
its first word is sung, its end, and a time per word. Lines the take never sings are left out, so the lyric video
only shows what you hear; an instrumental tail after the last line becomes the credits and end card. The tempo and
first downbeat come from the audio (onset autocorrelation), so the lyric video's beat grid follows the take.

Writes assets/contribution-song[-acoustic].{mp3,json,lrc} and records the pin in assets/song-pins.json. While a style
is pinned, contribution_song.py keeps its files and visitor_take.py --check says no new take is needed for it, so no
nightly run replaces it or spends credit on it. Unpin by deleting its entry from song-pins.json.
Run it again with another file to swap the audio; everything is regenerated from the file.
"""
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import ASSETS, write_atomic  # noqa: E402

SR = 22050
PINS = os.path.join(ASSETS, "song-pins.json")
SECTION_NAMES = {"bridge": "Breakdown", "breakdown": "Breakdown", "hook": "Hook", "intro": "Intro", "outro": "Outro",
                 "chorus": "Chorus", "build": "Build"}


def decode(path, sr=SR):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def read_sheet(path):
    """[(section, text)] in order; repeated [Verse] headers become Verse 1, Verse 2, ..."""
    out, sec, verses = [], "Verse", 0
    for row in open(path, encoding="utf-8").read().splitlines():
        row = row.strip()
        m = re.fullmatch(r"\[([^\]]+)\]", row)
        if m:
            name = m[1].strip()
            if name.lower().startswith("verse"):
                verses += 1
                sec = f"Verse {verses}"
            else:
                sec = SECTION_NAMES.get(name.lower(), name)
            continue
        if row:
            out.append((sec, row))
    return out


def norm(w):
    w = w.lower().replace("’", "'")
    w = re.sub(r"(?<=\d),(?=\d)", "", w)
    return re.sub(r"[^a-z0-9']", "", w)


def transcribe(path, prompt):
    from faster_whisper import WhisperModel
    model = WhisperModel(os.environ.get("PIN_WHISPER", "small.en"), device="cpu", compute_type="int8")
    audio = decode(path, 16000).astype(np.float32)  # decoded with ffmpeg, so no PyAV version issues
    segs, _ = model.transcribe(audio, word_timestamps=True, initial_prompt=prompt[:800], vad_filter=False,
                               condition_on_previous_text=False, beam_size=5)
    words = []
    for s in segs:
        for w in s.words or []:
            if norm(w.word):
                words.append((norm(w.word), float(w.start), float(w.end)))
    return words


def align(sheet, heard):
    """Each sheet line -> (t, end, [(word, t)]) or None when it isn't sung."""
    toks = []  # (line index, word index, norm)
    for li, (_, text) in enumerate(sheet):
        for wi, w in enumerate(text.split()):
            toks.append((li, wi, norm(w)))
    sm = difflib.SequenceMatcher(None, [t[2] for t in toks], [h[0] for h in heard], autojunk=False)
    hit = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            hit[a + k] = heard[b + k]
    out = []
    pos = 0
    for li, (_, text) in enumerate(sheet):
        ws = text.split()
        idx = list(range(pos, pos + len(ws)))
        pos += len(ws)
        got = [(i - idx[0], hit[i]) for i in idx if i in hit]
        if len(got) < max(2, 0.34 * len(ws)):
            out.append(None)
            continue
        times = [None] * len(ws)
        ends = [None] * len(ws)
        for wi, (_, t, e) in got:
            times[wi], ends[wi] = t, e
        known = [i for i, t in enumerate(times) if t is not None]
        for i in range(len(ws)):  # words Whisper heard differently: spread between the neighbours it did hear
            if times[i] is None:
                lo = max((k for k in known if k < i), default=None)
                hi = min((k for k in known if k > i), default=None)
                if lo is not None and hi is not None:
                    times[i] = times[lo] + (times[hi] - times[lo]) * (i - lo) / (hi - lo)
                elif lo is not None:
                    times[i] = ends[lo] + 0.28 * (i - lo - 1)
                else:
                    times[i] = times[hi] - 0.28 * (hi - i)
        last = max(known)
        end = ends[last] + 0.28 * (len(ws) - 1 - last)
        out.append((round(times[0], 3), round(end, 3), [(w, round(t, 3)) for w, t in zip(ws, times)]))
    # keep lines in time order: a line that lands before the one ahead of it was a false match
    prev = -1.0
    for i, r in enumerate(out):
        if r and r[0] < prev:
            out[i] = None
        elif r:
            prev = r[0]
    return out


def tempo(y, hint=None):
    """(bpm, first downbeat in seconds) from the onset envelope's autocorrelation."""
    from scipy import signal
    hop = 512
    S = np.abs(signal.stft(y, fs=SR, nperseg=2048, noverlap=2048 - hop)[2])
    flux = np.maximum(0, np.diff(np.log1p(S * 100), axis=1)).sum(0)
    flux -= flux.mean()
    fr = SR / hop
    ac = np.correlate(flux, flux, "full")[len(flux) - 1:]
    cand = []
    for bpm in np.arange(60, 181, 0.5):
        lag = int(round(60 / bpm * fr))
        if lag < len(ac):
            score = ac[lag] + 0.5 * ac[min(len(ac) - 1, 2 * lag)]
            if hint:
                score *= np.exp(-0.5 * (np.log2(bpm / hint) / 0.25) ** 2) * 0.5 + 0.5
            cand.append((score, bpm))
    bpm = max(cand)[1]
    period = 60 / bpm * fr
    # phase: the offset whose beat grid sits on the most onset energy, then the bar with the strongest downbeat
    grid = lambda o: np.minimum(len(flux) - 1, np.round(np.arange(o, len(flux) - 1, period)).astype(int))  # noqa: E731
    best = max(range(max(1, int(period))), key=lambda o: flux[grid(o)].sum())
    beats = grid(best)
    strength = [flux[beats[k::4]].sum() for k in range(4)]
    first = beats[int(np.argmax(strength))] / fr
    return round(float(bpm), 2), round(float(first % (4 * 60 / bpm)), 3)


def peaks(y, n=400):
    k = max(1, len(y) // n)
    p = np.abs(y[:k * n]).reshape(n, k).max(1)
    return [round(float(v), 3) for v in p / (p.max() or 1)]


def lrc(lines, title, artist="Nishal K"):
    out = [f"[ti:{title}]", f"[ar:{artist}]"]
    for l in lines:
        m, s = divmod(l["t"], 60)
        out.append(f"[{int(m):02d}:{s:05.2f}]{l['text']}")
    return "\n".join(out) + "\n"


def main():
    a = sys.argv[1:]
    if len(a) < 2 or a[0] not in ("original", "acoustic") or "--sheet" not in a:
        sys.exit(__doc__)
    if a[0] == "original" and "--out" not in a:
        # the Original is still rebuilt from the contribution data every night (contribution_song.py), so pinning it
        # isn't wired in yet; --out <dir> writes the timings for a candidate take there without touching assets/
        sys.exit("pinning the Original isn't wired in yet: use --out <dir> to time a candidate take")
    style, take = a[0], a[1]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d  # noqa: E731
    sheet = read_sheet(opt("--sheet"))
    engine = opt("--engine", "Runware · MiniMax Music 2.6")
    hint = float(opt("--bpm-hint", "110" if style == "acoustic" else "140"))
    key = opt("--key", "A minor")
    base = "contribution-song" + ("-acoustic" if style == "acoustic" else "")
    out_dir = opt("--out")
    y = decode(take)
    length = len(y) / SR
    heard = transcribe(take, " ".join(t for _, t in sheet))
    al = align(sheet, heard)
    lines = []
    for (sec, text), r in zip(sheet, al):
        if r:
            lines.append(dict(t=r[0], end=r[1], section=sec, text=text, words=[[w, t] for w, t in r[2]]))
    bpm, beat0 = tempo(y, hint)
    bar = 4 * 60 / bpm
    secs = []
    for l in lines:
        if not secs or secs[-1]["name"] != l["section"]:
            secs.append(dict(name=l["section"], start=l["t"]))
    last_end = max((l["end"] for l in lines), default=0.0)
    data = dict(style=style, title="Contribution song" + (" (acoustic)" if style == "acoustic" else ""),
                length=round(length, 3), bpm=bpm, bar=round(bar, 6), beat0=beat0, key=key, engine=engine,
                src=f"{base}.mp3", pinned=True, generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                sections=secs, lines=lines, instrumental_from=round(last_end, 3),
                unsung=[t for (_, t), r in zip(sheet, al) if not r], peaks=peaks(y))
    dest = out_dir or ASSETS
    os.makedirs(dest, exist_ok=True)
    shutil.copyfile(take, os.path.join(dest, f"{base}.mp3"))
    write_atomic(os.path.join(dest, f"{base}.json"), json.dumps(data, separators=(",", ":")))
    write_atomic(os.path.join(dest, f"{base}.lrc"), lrc(lines, data["title"]))
    if out_dir:
        print(f"timed {take} into {out_dir}: {length:.1f}s, {bpm} BPM, {len(lines)}/{len(sheet)} lines sung (not pinned)")
        return
    pins = json.load(open(PINS)) if os.path.exists(PINS) else {}
    pins[style] = dict(file=f"{base}.mp3", engine=engine, sheet=os.path.relpath(opt("--sheet"), os.path.dirname(ASSETS)),
                       bpm=bpm, length=round(length, 3), lines=len(lines), unsung=len(data["unsung"]), pinned=data["generated"])
    write_atomic(PINS, json.dumps(pins, indent=1) + "\n")
    print(f"pinned {style}: {take} -> assets/{base}.mp3, {length:.1f}s, {bpm} BPM (first downbeat {beat0}s), "
          f"{len(lines)}/{len(sheet)} lines sung, instrumental from {last_end:.1f}s")
    for (sec, text), r in zip(sheet, al):
        print(f"  {'%7.2f' % r[0] if r else '   --  '}  {sec:10s} {text}")


if __name__ == "__main__":
    main()
