"""Draw the song's cover from contribution-song.json: a record whose grooves are the year.

53 spokes (one per week, clockwise from 12 o'clock) and 7 rings (Sunday inside, Saturday
outside). Each dot's size follows that day's contributions. The sleeve color comes from
the busiest month. player.js draws the same record live; keep the two in sync.

Writes cover.png (512 square, lock screen and icon) and og.png (1200x630 link preview).
Usage: python3 make_cover.py <site dir with contribution-song.json>
"""
import json
import math
import sys
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = HERE / "fonts" / "bricolage-grotesque.woff2"
INK = (13, 14, 12)
# Sleeve color per busiest month, Jan..Dec. Same table as SLEEVES in player.js.
SLEEVES = ["#a9d6f5", "#cbef4a", "#ff8a65", "#f6a6c6", "#7fe3b4", "#ffc53d",
           "#5cd6cf", "#ff9f43", "#c3b1ff", "#ff7a3d", "#e6d3a3", "#ff6b6b"]


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    """Blend two RGB colors. ImageDraw replaces pixels instead of compositing, so blend by hand."""
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def font(size, weight):
    f = ImageFont.truetype(str(FONT), size)
    try:
        f.set_variation_by_axes([min(96, max(12, size)), weight, 100])
    except Exception:
        pass
    return f


def sleeve_color(song):
    month = int(song["stats"]["month"][5:7])
    return rgb(SLEEVES[month - 1])


def disc(song, size, ground):
    """The record alone on a transparent square, drawn at 2x then reduced for smooth edges."""
    k = 2
    S = size * k
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    R = S / 2 * 0.985
    d.ellipse([c - R, c - R, c + R, c + R], fill=INK + (255,))
    for g in range(60):  # grooves
        r = R * (0.34 + 0.64 * g / 59)
        d.ellipse([c - r, c - r, c + r, c + r], outline=mix(INK, (255, 255, 255), 0.06) + (255,), width=k)
    weeks = song["weeks"]
    n = len(weeks)
    dmax = max([1] + [x for w in weeks for x in w["days"]])
    r0, r1 = 0.40, 0.92
    for i, w in enumerate(weeks):
        a = math.radians(-90 + (i + 0.5) * 360 / n)
        for day in range(7):
            rr = R * (r0 + day * (r1 - r0) / 6)
            room = min(rr * 2 * math.pi / n, R * (r1 - r0) / 6) * 0.46
            cnt = w["days"][day] if day < len(w["days"]) else 0
            x, y = c + rr * math.cos(a), c + rr * math.sin(a)
            if cnt:
                dr = room * (0.38 + 0.62 * math.sqrt(cnt / dmax))
                d.ellipse([x - dr, y - dr, x + dr, y + dr], fill=ground + (255,))
            else:
                dr = room * 0.16
                d.ellipse([x - dr, y - dr, x + dr, y + dr], fill=mix(INK, ground, 0.3) + (255,))
    L = R * 0.31  # center label
    d.ellipse([c - L, c - L, c + L, c + L], fill=ground + (255,))
    total = str(song["stats"]["total"])
    d.text((c, c + L * 0.02), total, font=font(int(L * 0.62), 800), fill=INK, anchor="mm")
    small = font(int(L * 0.13), 650)
    d.text((c, c - L * 0.52), "NISHAL K", font=small, fill=INK, anchor="mm")
    d.text((c, c + L * 0.52), "CONTRIBUTIONS", font=small, fill=INK, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


def span(song):
    s = song["stats"]
    a, b = date.fromisoformat(s["first"]), date.fromisoformat(s["last"])
    return f"{a:%b %Y} to {b:%b %Y}".upper()


def cover(song, size=1024):
    ground = sleeve_color(song)
    im = Image.new("RGB", (size, size), ground)
    D = int(size * 0.80)
    rec = disc(song, D, ground)
    im.paste(rec, ((size - D) // 2 + int(size * 0.06), (size - D) // 2 + int(size * 0.06)), rec)
    d = ImageDraw.Draw(im)
    m = int(size * 0.05)
    big = font(int(size * 0.052), 800)
    d.text((m, m), "Contribution", font=big, fill=INK)
    d.text((m, m + int(size * 0.056)), "song", font=big, fill=INK)
    tiny = font(int(size * 0.02), 600)
    d.text((size - m, m + int(size * 0.008)), f"{song['bpm']} BPM", font=tiny, fill=INK, anchor="ra")
    d.text((size - m, m + int(size * 0.036)), song["key"].upper(), font=tiny, fill=INK, anchor="ra")
    d.text((m, size - m), span(song), font=tiny, fill=INK, anchor="ls")
    return im


def og(song, cov):
    W, H = 1200, 630
    ground = sleeve_color(song)
    im = Image.new("RGB", (W, H), INK)
    im.paste(cov.resize((H, H), Image.LANCZOS), (0, 0))
    d = ImageDraw.Draw(im)
    x = H + 56
    d.text((x, 70), "NISHAL K", font=font(26, 650), fill=ground)
    title = font(76, 800)
    d.text((x, 112), "Contribution", font=title, fill=(245, 246, 240))
    d.text((x, 190), "song", font=title, fill=(245, 246, 240))
    body = font(28, 450)
    s = song["stats"]
    lines = [f"{s['total']} GitHub contributions,", "one bar per week,", "lyrics from the real numbers."]
    for k, line in enumerate(lines):
        d.text((x, 318 + k * 40), line, font=body, fill=(200, 204, 192))
    d.text((x, H - 70), "nishal21.github.io/nishal21/player", font=font(22, 550), fill=ground, anchor="ls")
    return im


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    song = json.loads((site / "contribution-song.json").read_text())
    cov = cover(song)
    small = lambda im: im.quantize(96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    small(cov.resize((512, 512), Image.LANCZOS)).save(site / "cover.png", optimize=True)
    small(og(song, cov)).save(site / "og.png", optimize=True)
    print("cover.png and og.png written")


if __name__ == "__main__":
    main()
