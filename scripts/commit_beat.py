"""Commit beat: the last 16 days of contributions as a drum-machine pattern, plus an 8-second loop.

Each column is one day. A day turns on more pads the busier it was:
  Kick >= 1, Hat >= 3, Snare >= 6, Clap >= 10 contributions.
Pad brightness and hit volume scale with the day's count relative to the busiest day in the window.
"""
import os
import shutil
import subprocess
import tempfile

from common import ASSETS, CARD_H, CARD_W, FONT, THEMES, card_open, contribution_calendar, esc, fail, write_atomic

DAYS = 16
BPM = 120
LOOPS = 4
RATE = 22050
ROWS = [("Kick", 1, "title"), ("Snare", 6, "text"), ("Hat", 3, "icon"), ("Clap", 10, "warn")]


def pattern(cal):
    days = sorted(cal)[-DAYS:]
    counts = [cal[d] for d in days]
    return days, counts


def render(days, counts, t):
    w, h = CARD_W, CARD_H
    total = sum(counts)
    peak = max(counts) or 1
    out = [card_open(t, label=f"Commit beat: {total} contributions from {days[0]} to {days[-1]}")]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Commit beat</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{BPM} BPM · {DAYS} steps · 1 step = 1 day</text>')
    gx, gy, step, row_h, pad_w, pad_h = 75, 52, 24.7, 23, 20.5, 18
    for b in range(0, DAYS, 4):  # bar groups, like a 4/4 sequencer
        out.append(f'<rect x="{gx + b*step - 2:.1f}" y="{gy-3}" width="{4*step:.1f}" height="{4*row_h+2}" rx="3" fill="{t["faint"]}" fill-opacity="{0.55 if b % 8 == 0 else 0.25}"/>')
    for r, (name, need, color) in enumerate(ROWS):
        y = gy + r * row_h
        out.append(f'<text x="25" y="{y+13}" font-family="{FONT}" font-size="12" font-weight="600" fill="{t["muted"]}">{name}</text>')
        for i, c in enumerate(counts):
            x = gx + i * step
            on = c >= need
            fill = t[color] if on else t["pad_off"]
            op = f"{0.45 + 0.55*c/peak:.2f}" if on else "1"
            out.append(f'<rect x="{x:.1f}" y="{y}" width="{pad_w}" height="{pad_h}" rx="3" fill="{fill}" fill-opacity="{op}"><title>{days[i]}: {c}</title></rect>')
    # day numbers under the grid
    ly = gy + 4 * row_h + 12
    for i, d in enumerate(days):
        out.append(f'<text x="{gx + i*step + pad_w/2:.1f}" y="{ly}" text-anchor="middle" font-family="{FONT}" font-size="9" fill="{t["muted"]}" fill-opacity="{1 if i % 4 == 0 else 0.6}">{d.day}</text>')
    rng = f"{days[0].strftime('%b %-d')} to {days[-1].strftime('%b %-d, %Y')}"
    out.append(f'<text x="25" y="{h-18}" font-family="{FONT}" font-size="11.5" fill="{t["text"]}"><tspan font-weight="700">{total}</tspan> contributions · {esc(rng)}</text>')
    out.append(f'<text x="{w-25}" y="{h-18}" text-anchor="end" font-family="{FONT}" font-size="10" fill="{t["muted"]}">kick 1+ · hat 3+ · snare 6+ · clap 10+</text>')
    out.append("</svg>\n")
    return "\n".join(out)


def synth(counts):
    """Render the pattern to mono float samples with numpy: 16th notes at BPM, looped."""
    import numpy as np
    rng = np.random.default_rng(16)
    spb = int(RATE * 60 / BPM / 4)
    peak = max(counts) or 1

    def env(n, decay):
        return np.exp(-np.arange(n) / (RATE * decay))

    def kick():
        n = int(RATE * 0.3)
        tt = np.arange(n) / RATE
        f = 50 + 110 * np.exp(-tt * 30)
        return np.sin(2 * np.pi * np.cumsum(f) / RATE) * env(n, 0.09)

    def snare():
        n = int(RATE * 0.2)
        tt = np.arange(n) / RATE
        return (0.7 * rng.uniform(-1, 1, n) + 0.4 * np.sin(2 * np.pi * 190 * tt)) * env(n, 0.05)

    def hat():
        n = int(RATE * 0.06)
        x = rng.uniform(-1, 1, n)
        x = np.diff(x, prepend=0)  # crude high-pass
        return 0.5 * x * env(n, 0.012)

    def clap():
        n = int(RATE * 0.25)
        x = rng.uniform(-1, 1, n)
        e = np.zeros(n)
        for off in (0, 0.01, 0.02):
            s = int(off * RATE)
            e[s:] += env(n - s, 0.008 if off < 0.02 else 0.07)
        return 0.6 * x * e

    voices = {"Kick": kick(), "Snare": snare(), "Hat": hat(), "Clap": clap()}
    bar = np.zeros(spb * len(counts) + RATE // 2)
    for i, c in enumerate(counts):
        vol = 0.35 + 0.65 * c / peak
        for name, need, _ in ROWS:
            if c >= need:
                v = voices[name]
                bar[i * spb:i * spb + len(v)] += vol * v
    loop_len = spb * len(counts)
    out = np.zeros(loop_len * LOOPS + RATE // 2)
    for k in range(LOOPS):
        out[k * loop_len:k * loop_len + len(bar)] += bar
    out = out[:loop_len * LOOPS]
    m = np.max(np.abs(out))
    if m > 0:
        out = 0.9 * out / m
    return out


def write_mp3(samples, path):
    import wave
    import numpy as np
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found; keeping the previous audio file")
        return False
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "beat.wav")
        with wave.open(wav, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(RATE)
            wf.writeframes((samples * 32767).astype(np.int16).tobytes())
        mp3 = os.path.join(d, "beat.mp3")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "64k",
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", mp3], check=True)
        with open(mp3, "rb") as f:
            write_atomic(path, f.read())
    return True


def main():
    try:
        days, counts = pattern(contribution_calendar())
    except Exception as e:
        fail(str(e))
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"commit-beat-{name}.svg"), render(days, counts, t))
    try:
        if write_mp3(synth(counts), os.path.join(ASSETS, "commit-beat.mp3")):
            print("audio written")
    except Exception as e:  # the SVGs are still good; keep the last audio
        print(f"audio failed, keeping previous file: {e}")
    print(f"commit beat: {days[0]} to {days[-1]}, counts {counts}, total {sum(counts)}")


if __name__ == "__main__":
    main()
