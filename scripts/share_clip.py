"""A 15 second vertical clip (1080x1920, H.264 + AAC) of the busiest week in the song, for X, Reels and
Shorts: the real audio around that week's bar, the record from the player spinning with the playing
week's dots flashing on their hits, the lyric line at that moment, and a few stats.

Usage: python3 scripts/share_clip.py <site dir with contribution-song.json and .mp3> [out.mp4]
Frames are drawn with Pillow and piped to ffmpeg; about a minute on a GitHub runner.
"""
import json
import math
import subprocess
import sys
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "player"))
import make_cover as MC  # noqa: E402  (same record, fonts and colors as the player)

W, H, FPS, LEN = 1080, 1920, 30, 15.0
INK = MC.INK
WHITE = (245, 246, 240)
SOFT = (200, 204, 192)
URL = "nishal21.github.io/nishal21/player"
HANDLE = "@nishal21"
DAY_STEP = 1 / 8  # day d plays at d/8 of its bar (player.js uses the same)
MONO = Path(MC.HERE) / "fonts" / "jetbrains-mono.woff2"


def mono(size, weight=500):
    from PIL import ImageFont
    f = ImageFont.truetype(str(MONO), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:3]


def busiest(song):
    tot = [sum(w["days"]) for w in song["weeks"]]
    return max(range(len(tot)), key=lambda i: (tot[i], i))


def choose_window(song, b):
    """15 s that always has lyrics on screen: the window holding the busiest week's bar and the most
    complete lyric lines (at least 2), as centred on that bar as possible. If no such window exists,
    the chorus closest to the busiest week."""
    bar, length, lines = song["bar"], song["length"], song["lines"]
    last = max(0.0, length - LEN)
    a, e = b * bar, (b + 1) * bar

    def count(s):
        return sum(1 for l in lines if l["t"] >= s and l["end"] <= s + LEN)

    best = None
    for k in range(int(last / 0.25) + 1):
        s = k * 0.25
        if s <= a and e <= s + LEN and count(s) >= 2:
            score = (count(s), -abs(s + LEN / 2 - (a + e) / 2))
            if best is None or score > best[0]:
                best = (score, s)
    if best:
        return best[1], f"busiest week with {best[0][0]} lyric lines"
    choruses = [x["start"] for x in song["sections"] if x["name"] == "Chorus"]
    c = min(choruses, key=lambda t: abs(t - a))
    return min(max(0.0, c - 0.3), last), "nearest chorus (busiest week has no lyrics nearby)"


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site/player")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else site / "share-clip.mp4"
    song = json.loads((site / "contribution-song.json").read_text())
    weeks, bar = song["weeks"], song["bar"]
    n = len(weeks)
    b = busiest(song)
    start, why = choose_window(song, b)
    ground = MC.sleeve_color(song)
    dmax = max([1] + [x for w in weeks for x in w["days"]])

    # static layers
    S = 960
    D = int(S * 0.80)
    disc = MC.disc(song, D, ground)
    R = D / 2 * 0.985
    r0, r1 = 0.40, 0.92
    L = R * 0.31
    sx, sy = (W - S) // 2, 300
    base = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(base)
    d.text((60, 92), "NISHAL K", font=MC.font(34, 650), fill=ground)
    d.text((60, 140), "Contribution song", font=MC.font(84, 800), fill=WHITE)
    d.rounded_rectangle([sx, sy, sx + S, sy + S], radius=28, fill=ground)
    cd = ImageDraw.Draw(base)
    m = int(S * 0.05)
    cd.text((sx + m, sy + m), f"{song['bpm']} BPM  ·  {song['key'].upper()}", font=MC.font(26, 650), fill=INK)
    wk = weeks[b]
    wtot = sum(wk["days"])
    stats = [("BUSIEST WEEK", date.fromisoformat(wk["start"]).strftime("%b %d, %Y").upper()),
             ("THAT WEEK", f"{wtot} contributions"),
             ("12 MONTHS", f"{song['stats']['total']} contributions")]
    if wk.get("lang"):
        stats[0] = ("BUSIEST WEEK", stats[0][1] + f"  ·  {wk['lang'].upper()}")
    y = 1560
    for k, (lab, val) in enumerate(stats):
        d.text((60, y + k * 62), lab, font=mono(26, 500), fill=ground)
        d.text((330, y + k * 62 - 4), val, font=MC.font(40, 650), fill=WHITE)
    d.text((60, H - 70), HANDLE, font=MC.font(40, 800), fill=WHITE, anchor="ls")
    d.text((W - 60, H - 70), URL, font=mono(26, 500), fill=SOFT, anchor="rs")
    cx, cy = sx + S // 2 + int(S * 0.04), sy + S // 2 + int(S * 0.04)
    lyric_font = MC.font(54, 700)
    label_big, label_small = MC.font(int(L * 0.62), 800), MC.font(int(L * 0.13), 650)

    enc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-ss", f"{start:.3f}", "-t", str(LEN), "-i", str(site / "contribution-song.mp3"),
         "-af", f"afade=t=in:d=0.4,afade=t=out:st={LEN - 1.0}:d=1.0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
         "-profile:v", "high", "-level", "4.1", "-g", str(FPS * 2),
         "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-shortest", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    lines = song["lines"]
    for f in range(int(LEN * FPS)):
        t = start + f / FPS
        pos = t / bar
        im = base.copy()
        turn = ((pos - 0.5) * 360) / n  # PIL turns counter-clockwise, the player turns the other way
        rot = disc.rotate(turn, resample=Image.BICUBIC)
        im.paste(rot, (cx - D // 2, cy - D // 2), rot)
        dd = ImageDraw.Draw(im)
        cur = min(max(int(pos), 0), n - 1)
        frac = pos - int(pos)
        a = math.radians(-90 + ((cur + 0.5) * 360) / n - ((pos - 0.5) * 360) / n)
        for day in range(7):
            cnt = weeks[cur]["days"][day] if day < len(weeks[cur]["days"]) else 0
            rr = R * (r0 + day * (r1 - r0) / 6)
            room = min(rr * 2 * math.pi / n, R * (r1 - r0) / 6) * 0.46
            since = frac - day * DAY_STEP
            hit = 1 - since / 0.12 if cnt and 0 <= since < 0.12 else 0
            dr = (room * (0.38 + 0.62 * math.sqrt(cnt / dmax)) if cnt else room * 0.2) * (1 + hit * 0.9)
            x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
            dd.ellipse([x - dr, y - dr, x + dr, y + dr], fill=(255, 255, 255) if cnt else (120, 120, 116))
        dd.ellipse([cx - L, cy - L, cx + L, cy + L], fill=ground)
        dd.text((cx, cy + L * 0.04), str(song["stats"]["total"]), font=label_big, fill=INK, anchor="mm")
        dd.text((cx, cy - L * 0.52), "NISHAL K", font=label_small, fill=INK, anchor="mm")
        dd.text((cx, cy + L * 0.52), "CONTRIBUTIONS", font=label_small, fill=INK, anchor="mm")
        top = cy - R
        dd.polygon([(cx - 12, top - 30), (cx + 12, top - 30), (cx, top - 6)], fill=INK)
        # lyric playing now (or the last one, dimmed, between lines)
        line = next((l for l in lines if l["t"] - 0.15 <= t <= l["end"] + 0.4), None)
        if line:
            for k, row in enumerate(wrap(dd, line["text"], lyric_font, W - 120)):
                dd.text((60, 1310 + k * 70), row, font=lyric_font, fill=WHITE)
            dd.text((60, 1268), line["section"].upper(), font=mono(24, 500), fill=ground)
        # progress through the clip
        dd.rectangle([60, 1500, W - 60, 1504], fill=(48, 50, 46))
        dd.rectangle([60, 1500, 60 + (W - 120) * f / (LEN * FPS), 1504], fill=ground)
        enc.stdin.write(im.tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit("ffmpeg failed")
    print(f"{out}: week {b + 1} ({wk['start']}, {wtot} contributions), audio {start:.2f}-{start + LEN:.2f}s: {why}")


if __name__ == "__main__":
    main()
