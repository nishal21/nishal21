"""The visitor song as a lyric video for the Videos page.

A 1080p kinetic type video: letterbox, flat colour, film grain, a slow camera drift. Each lyric line shows up as a
faint ghost just before it is sung, then every word rises in and lights up as the voice reaches it, with a small
card naming who wrote the line. Open Doodles (CC0) sit in their own column and draw on with a wipe; each drawing is
used once in the whole video, so when the song has more lines than drawings, some lines go without one.
A title card opens it and a credits roll lists everyone at the end.

Timing comes from assets/visitor-song.lrc (line starts and credits) and assets/visitor-song.json (sections, length);
inside a line each word lights up at the time Whisper heard it in the sung take (visitor_take.py), or, for the
Kokoro fallback, the words are spread by syllables over the time the voice takes to sing it.

Writes visitor-song.mp4 and visitor-poster.jpg into the given folder. Needs ffmpeg, Pillow and CairoSVG.
Usage: visitor_video.py OUT_DIR [--lrc FILE --json FILE --mp3 FILE] [--frames t1,t2,...]
"""
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")
ART = os.path.join(ROOT, "player", "art")
FONTS = os.path.join(ROOT, "player", "fonts")
W, H, FPS = 1920, 1080, 24
BAR = 132                                   # letterbox, about 2.39:1 inside
TOP, BOTTOM = BAR, H - BAR
TEXT_X, TEXT_W = 156, 1000                  # the lyric column
ART_BOX = (1250, 236, 1780, 844)            # the drawing column; the two never meet

INK = (17, 17, 17)
PAPER = (243, 239, 229)
LIME = (227, 251, 29)
PINK = (255, 86, 120)
NIGHT = (22, 22, 24)
# section -> (background, text, accent)
LOOKS = {"Intro": (PAPER, INK, PINK), "Verse": (PAPER, INK, PINK), "Chorus": (LIME, INK, PINK),
         "Outro": (NIGHT, PAPER, LIME), "Credits": (NIGHT, PAPER, LIME)}


def ease(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


# ---------- type ----------
_fonts = {}


def font(size, weight="ExtraBold", mono=False):
    key = (size, weight, mono)
    if key not in _fonts:
        path = os.path.join(FONTS, "jetbrains-mono.woff2" if mono else "bricolage-grotesque.woff2")
        try:
            f = ImageFont.truetype(path, size)
            try:
                f.set_variation_by_name(weight)
            except Exception:  # noqa: BLE001
                pass
        except OSError:
            f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("Mono" if mono else "-Bold") + ".ttf", size)
        _fonts[key] = f
    return _fonts[key]


_glyphs = {}


def word_img(text, f, colour):
    """A word as an RGBA image plus its advance width, cached."""
    key = (text, id(f), colour)
    if key not in _glyphs:
        l, t, r, b = f.getbbox(text)
        asc, desc = f.getmetrics()
        im = Image.new("L", (max(1, r) + 8, asc + desc + 8), 0)
        ImageDraw.Draw(im).text((0, 0), text, font=f, fill=255)
        _glyphs[key] = (im, f.getlength(text))
    return _glyphs[key]


_masks = {}


def faded(mask, a):
    a = round(min(1, max(0, a)) * 16) / 16
    if a >= 1:
        return mask
    key = (id(mask), a)
    if key not in _masks:
        _masks[key] = mask.point(lambda v: int(v * a))
    return _masks[key]


def put(frame, mask, xy, colour, a=1.0):
    if a <= 0.01:
        return
    frame.paste(colour, (int(xy[0]), int(xy[1])), faded(mask, a))


def syllables(word):
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 1
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and n > 1 and not w.endswith("le"):
        n -= 1
    return max(1, n)


def wrap(words, f, width):
    """Greedy wrap; a word wider than the column is broken into pieces."""
    space = f.getlength(" ")
    out, row, x = [], [], 0.0
    pieces = []
    for w in words:
        while f.getlength(w) > width:
            k = len(w)
            while k > 1 and f.getlength(w[:k] + "-") > width:
                k -= 1
            pieces.append(w[:k] + "-")
            w = w[k:]
        pieces.append(w)
    for w in pieces:
        lw = f.getlength(w)
        if row and x + space + lw > width:
            out.append(row)
            row, x = [], 0.0
        x = x + (space if row else 0) + lw
        row.append(w)
    if row:
        out.append(row)
    return out


def layout(text, width=TEXT_W, max_rows=3):
    words = text.split()
    for size in (112, 100, 88, 76, 66, 58, 50, 44):
        f = font(size)
        rows = wrap(words, f, width)
        if len(rows) <= max_rows:
            return f, rows
    return font(44), wrap(words, font(44), width)


# ---------- drawings ----------
def doodles(n_wanted):
    """Every Open Doodle we ship, each at most once, in a fixed shuffled order."""
    files = [os.path.join(ART, f) for f in sorted(os.listdir(ART)) if f.endswith(".svg")]
    page = os.path.join(ART, "page")
    if os.path.isdir(page):
        files += [os.path.join(page, f) for f in sorted(os.listdir(page)) if f.endswith(".svg")]
    files.sort(key=lambda p: hashlib.md5(os.path.basename(p).encode()).hexdigest())
    return files[:n_wanted]


def raster(svg, ink, accent, box_w, box_h):
    import cairosvg
    with open(svg) as f:
        s = f.read()
    s = re.sub(r'fill="#000(000)?"', 'fill="#%02x%02x%02x"' % ink, s, flags=re.I)
    s = re.sub(r'fill="#FF5678"', 'fill="#%02x%02x%02x"' % accent, s, flags=re.I)
    png = cairosvg.svg2png(bytestring=s.encode(), output_width=box_w * 2)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    im.thumbnail((box_w, box_h), Image.LANCZOS)
    return im


# ---------- the plan ----------
def load(lrc_path, json_path, mp3):
    with open(json_path) as f:
        data = json.load(f)
    rows = []
    for ln in open(lrc_path, encoding="utf-8"):
        m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)", ln.strip())
        if not m:
            continue
        t = int(m[1]) * 60 + float(m[2])
        body = m[3].strip()
        who = "Nishal K"
        c = re.match(r"(.*)\s+\(([^()]+)\)$", body)
        if c:
            body, who = c[1].strip(), c[2].strip()
        rows.append(dict(t=t, text=body, who=who))
    rows.sort(key=lambda r: r["t"])
    secs = {round(l["t"], 2): l.get("section", "Verse") for l in data.get("lines", [])}
    sung_words = {l["t"]: l["words"] for l in data.get("lines", []) if l.get("words")}
    for i, r in enumerate(rows):
        r["section"] = secs.get(round(r["t"], 2), "Verse")
        nxt = rows[i + 1]["t"] if i + 1 < len(rows) else r["t"] + 5.0
        r["next"] = nxt
        sy = [syllables(w) for w in r["text"].split()]
        sung = min(max(1.4, 0.2 * sum(sy) + 0.5), (nxt - r["t"]) * 0.9)  # how long the voice takes (Whisper-checked)
        acc, r["words"] = r["t"] - 0.05, []
        for w, s in zip(r["text"].split(), sy):
            r["words"].append((w, acc))
            acc += sung * s / sum(sy)
        heard = next((v for k, v in sung_words.items() if abs(k - r["t"]) < 0.02), None)
        if heard and len(heard) == len(r["words"]):  # a sung take: each word lights up when the voice reaches it
            r["words"] = [(w, max(r["t"] - 0.05, float(t) - 0.05)) for (w, _), (_, t) in zip(r["words"], heard)]
    length = float(data.get("length") or 0)
    if os.path.exists(mp3):
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3],
                             capture_output=True, text=True).stdout.strip()
        length = float(out or length or 30)
    return data, rows, length


class Video:
    def __init__(self, data, rows, length):
        self.rows, self.song = rows, length
        self.first = rows[0]["t"] if rows else 4.0
        self.last_end = (rows[-1]["next"] if rows else length)
        # contributors for the credits, first appearance order
        seen, self.people = set(), []
        for r in rows:
            if r["who"].startswith("@") and r["who"].lower() not in seen:
                seen.add(r["who"].lower())
                self.people.append((r["who"], r["text"]))
        self.notes = len(data.get("notes", []))
        self.engine = data.get("engine", "Kokoro")
        # credits roll: starts as the last line clears, scrolls at a calm, readable speed
        self.roll_start = max(self.last_end - 0.6, 1.0)
        self.credit_rows = self.build_credits()
        self.roll_h = sum(h for _, h in self.credit_rows)
        speed = 120.0
        self.roll_len = (self.roll_h + (BOTTOM - TOP)) / speed
        self.speed = speed
        self.end_card = self.roll_start + self.roll_len
        self.total = max(self.song, self.end_card + 4.0)
        # drawings: title, each line (evenly spread if they run out), credits. Never the same one twice.
        slots = ["title"] + [f"line{i}" for i in range(len(rows))] + ["credits"]
        pool = doodles(len(slots))
        if len(pool) < len(slots):
            keep = {"title", "credits"}
            k = max(0, len(pool) - 2)
            idx = [round(i * (len(rows) - 1) / max(1, k - 1)) for i in range(k)] if k and rows else []
            keep |= {f"line{i}" for i in sorted(set(idx))}
            slots = [s for s in slots if s in keep]
        self.art = dict(zip(slots, pool))
        self._raster = {}

    def build_credits(self):
        if NAME[0].startswith("contribution"):
            voice = ("person:ACE-Step 1.5|sung through deAPI" if self.engine == "deAPI" else
                     "person:Kokoro TTS|two voices" if self.engine == "Kokoro" else f"person:ACE-Step 1.5|{self.engine}")
            return [("label:contribution song", 90), ("big:A year of commits, sung", 150),
                    ("label:words and music", 80), ("person:Nishal K|github.com/nishal21", 118), ("gap:", 40),
                    ("label:voice", 80), (voice, 118), ("gap:", 40),
                    ("label:drawings", 80), ("person:Open Doodles|by Pablo Stanley, CC0", 118)]
        out = [("label:visitor song", 90), ("big:A song by everyone who stopped by", 150)]
        if self.people:
            out.append(("label:lyrics by visitors", 80))
            for who, line in self.people:
                out.append((f"person:{who}|{line}", 118))
            out.append(("gap:", 50))
        if self.engine == "Kokoro":
            out += [("label:words, music and the rest of the lyrics", 80), ("person:Nishal K|github.com/nishal21", 118)]
        else:
            where = "free ACE-Step cloud, sang this take" if self.engine == "acemusic.ai" else "ACE-Step on CPU, sang this take"
            out += [("label:the rest of the lyrics", 80), ("person:Nishal K|github.com/nishal21", 118),
                    ("gap:", 40), ("label:voice and music", 80),
                    ("person:ACE-Step 1.5|ACE Studio x StepFun · Apache-2.0", 118),
                    (f"person:{'acemusic.ai' if self.engine == 'acemusic.ai' else 'GitHub Actions'}|{where}", 118)]
        out += [("gap:", 40), ("label:drawings", 80), ("person:Open Doodles|by Pablo Stanley, CC0", 118),
                ("gap:", 40), ("label:notes in the song", 80), (f"big:{self.notes} and counting", 150)]
        return out

    def drawing(self, slot, look):
        path = self.art.get(slot)
        if not path:
            return None
        key = (slot, look)
        if key not in self._raster:
            bg, ink, acc = look
            self._raster[key] = raster(path, ink, acc, ART_BOX[2] - ART_BOX[0], ART_BOX[3] - ART_BOX[1])
        return self._raster[key]

    # one drawing, drawn on with a wipe from the left, then drifting a little (parallax against the text)
    def put_drawing(self, frame, slot, look, t0, t1, t, drift):
        im = self.drawing(slot, look)
        if im is None or t < t0 or t > t1:
            return
        p = ease((t - t0) / 0.9)
        out = 1 - ease((t - (t1 - 0.45)) / 0.45)
        w, h = im.size
        x = ART_BOX[0] + (ART_BOX[2] - ART_BOX[0] - w) // 2 + drift[0] * 3
        y = ART_BOX[1] + (ART_BOX[3] - ART_BOX[1] - h) // 2 + drift[1] * 3 + 4 * math.sin(t * 1.3)
        y += 20 * (1 - p)
        cut = max(1, int(w * p))
        part = im.crop((0, 0, cut, h))
        alpha = part.getchannel("A")
        if out < 1:
            alpha = alpha.point(lambda v: int(v * max(0, out)))
        frame.paste(part.convert("RGB"), (int(x), int(y)), alpha)
        self.box_drawn = (int(x), int(y), int(x) + cut, int(y) + h)

    def frame(self, t):
        self.box_drawn, self.box_text = None, []
        drift = (6 * math.sin(t * 0.21), 4 * math.cos(t * 0.17))
        if t < self.first - 0.5:
            look = LOOKS["Intro"]
        elif t >= self.roll_start:
            look = LOOKS["Credits"]
        else:
            cur = self.current(t)
            look = LOOKS.get(cur["section"] if cur else "Verse", LOOKS["Verse"])
        frame = Image.new("RGB", (W, H), look[0])
        if t < self.first - 0.5:
            self.title(frame, t, look, drift)
        elif t >= self.roll_start:
            self.credits(frame, t, look, drift)
        else:
            self.lyric(frame, t, look, drift)
        self.wipe(frame, t)
        d = ImageDraw.Draw(frame)
        d.rectangle((0, 0, W, TOP), fill=(0, 0, 0))
        d.rectangle((0, BOTTOM, W, H), fill=(0, 0, 0))
        # fade in from black and out to black
        k = min(1, t / 0.8, max(0, (self.total - t) / 1.2))
        if k < 1:
            frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), frame, max(0, k))
        return frame

    def current(self, t):
        cur = None
        for r in self.rows:
            if r["t"] - 0.5 <= t:
                cur = r
        return cur

    def wipe(self, frame, t):
        """A flat block slides across when the colour changes, on the line's downbeat."""
        changes = []
        prev = "Intro"
        for r in self.rows:
            if r["section"] != prev and LOOKS.get(r["section"]) != LOOKS.get(prev):
                changes.append((r["t"] - 0.5, LOOKS.get(r["section"], LOOKS["Verse"])))
            prev = r["section"]
        changes.append((self.roll_start, LOOKS["Credits"]))
        for at, look in changes:
            dt = t - (at - 0.35)
            if 0 <= dt < 0.6:
                p = ease(dt / 0.6)
                x0 = int(W * p) if dt > 0.35 else 0
                x1 = int(W * min(1, dt / 0.35))
                ImageDraw.Draw(frame).rectangle((x0, TOP, x1, BOTTOM), fill=look[2])

    def title(self, frame, t, look, drift):
        bg, ink, acc = look
        d = ImageDraw.Draw(frame)
        big = font(220)
        x, y = TEXT_X + drift[0], 300 + drift[1]
        for i, word in enumerate(("visitor", "song")):
            m, _ = word_img(word, big, ink)
            p = ease((t - 0.3 - i * 0.35) / 0.9)
            put(frame, m, (x, y + i * 205 + 50 * (1 - p)), ink, p)
        sub = f"{len(self.rows)} lines · {len(self.people)} visitor{'s' if len(self.people) != 1 else ''} · grows every night"
        m, wdt = word_img(sub, font(34, "Medium", True), ink)
        p = ease((t - 1.4) / 0.8)
        put(frame, m, (x + 8, y + 470), ink, p)
        if p > 0:
            d.rectangle((x + 8, y + 445, x + 8 + int(wdt * p), y + 451), fill=acc)
        self.box_text.append((x, y, x + 900, y + 520))
        self.put_drawing(frame, "title", look, 0.6, self.first - 0.5, t, drift)

    def lyric(self, frame, t, look, drift):
        bg, ink, acc = look
        idx = max(i for i, r in enumerate(self.rows) if r["t"] - 0.5 <= t)
        r = self.rows[idx]
        start, stop = r["t"] - 0.5, min(r["next"] - 0.5, self.roll_start)
        f, rows = layout(r["text"])
        lh = int(f.size * 1.08)
        block = lh * len(rows)
        y0 = (TOP + BOTTOM) // 2 - block // 2 - 40 + drift[1]
        x0 = TEXT_X + drift[0]
        # the line leaves by rising and fading in its last 0.35 s
        leave = ease((t - (stop - 0.35)) / 0.35)
        y0 -= 30 * leave
        ghost = (bg[0] * 0.78 + ink[0] * 0.22, bg[1] * 0.78 + ink[1] * 0.22, bg[2] * 0.78 + ink[2] * 0.22)
        ghost = tuple(int(c) for c in ghost)
        times = [wt for _, wt in r["words"]]
        k = 0
        space = f.getlength(" ")
        sung_now = None
        for ri, row in enumerate(rows):
            x = x0
            for w in row:
                wt = times[min(k, len(times) - 1)]
                if not w.endswith("-"):
                    k += 1
                m, adv = word_img(w, f, ink)
                y = y0 + ri * lh
                pre = ease((t - start) / 0.5)             # the whole line arrives faint, so you can read ahead
                lit = ease((t - wt) / 0.28)                # then each word rises and lights as it is sung
                a = 1 - leave
                if lit < 1:
                    put(frame, m, (x, y), ghost, pre * a)
                put(frame, m, (x, y + 18 * (1 - lit)), ink, lit * a)
                nxt = times[k] if k < len(times) else wt + 0.6
                if wt <= t < nxt:
                    sung_now = (x, y, adv)
                x += adv + space
            self.box_text.append((x0, y0 + ri * lh, x0 + TEXT_W, y0 + ri * lh + lh))
        d = ImageDraw.Draw(frame)
        if sung_now and leave < 0.5:                      # an underline that follows the voice
            x, y, adv = sung_now
            d.rectangle((x, y + f.size * 1.02, x + adv, y + f.size * 1.02 + 7), fill=acc)
        # who wrote it: a small card under a visitor's line
        cy = y0 + block + 34
        p = ease((t - start - 0.3) / 0.6) * (1 - leave)
        if p > 0.02 and r["who"].startswith("@"):  # only visitor lines get a card; Nishal is in the end credits
            visitor = True
            lab, lw = word_img("lyric by" if visitor else "words by", font(24, "Medium", True), ink)
            nm, nw = word_img(r["who"][:40], font(38, "Bold"), INK if visitor else ink)
            cw = int(max(lw, nw)) + 48
            cx = x0 + 4 - 16 * (1 - p)
            if visitor:
                card = (cx, cy, cx + cw, cy + 104)
                d.rectangle(card, fill=acc if look[0] != PINK else LIME)
                put(frame, lab, (cx + 24, cy + 14), INK, p)
                put(frame, nm, (cx + 24, cy + 46), INK, p)
            else:
                d.rectangle((cx, cy, cx + cw, cy + 104), outline=ink, width=3)
                put(frame, lab, (cx + 24, cy + 14), ink, p)
                put(frame, nm, (cx + 24, cy + 46), ink, p)
            self.box_text.append((cx, cy, cx + cw, cy + 104))
        # line counter, top left
        lab, _ = word_img(f"{r['section'].lower()} · {idx + 1:02d} / {len(self.rows):02d}", font(24, "Medium", True), ink)
        put(frame, lab, (TEXT_X, TOP + 40), ink, 0.7)
        self.put_drawing(frame, f"line{idx}", look, start + 0.15, stop, t, drift)

    def credits(self, frame, t, look, drift):
        bg, ink, acc = look
        d = ImageDraw.Draw(frame)
        y = BOTTOM - (t - self.roll_start) * self.speed + 20
        x = TEXT_X + 40
        for kind_text, h in self.credit_rows:
            kind, _, text = kind_text.partition(":")
            if TOP - 200 < y < BOTTOM + 10:
                if kind == "label":
                    m, _ = word_img(text, font(26, "Medium", True), acc)
                    put(frame, m, (x, y + 30), acc)
                elif kind == "big":
                    sz = 76
                    while sz > 40 and font(sz).getlength(text) > 1000:
                        sz -= 4
                    m, _ = word_img(text, font(sz), ink)
                    put(frame, m, (x, y + 20), ink)
                elif kind == "person":
                    who, line = text.split("|", 1)
                    sz = 52
                    while sz > 30 and font(sz, "Bold").getlength(who[:40]) > 1000:
                        sz -= 4
                    m, _ = word_img(who[:40], font(sz, "Bold"), ink)
                    put(frame, m, (x, y + 4), ink)
                    f2 = font(28, "Regular", True)
                    line = line if f2.getlength(line) < 980 else line[:60] + "…"
                    m, _ = word_img(line, f2, ink)
                    put(frame, m, (x + 2, y + 70), ink, 0.62)
                self.box_text.append((x, y, x + 1000, y + h))
            y += h
        # end card once the roll has passed
        if t > self.end_card - 0.5:
            p = ease((t - self.end_card + 0.5) / 0.8)
            m, _ = word_img("add your line", font(150), ink)
            put(frame, m, (TEXT_X, 380 + 30 * (1 - p)), ink, p)
            m, _ = word_img("github.com/nishal21 · leave a note on the profile", font(32, "Medium", True), acc)
            put(frame, m, (TEXT_X + 6, 590), acc, p)
            self.box_text.append((TEXT_X, 380, TEXT_X + 1000, 640))
        self.put_drawing(frame, "credits", look, self.roll_start + 0.6, self.total, t, drift)


def overlaps(a, b):
    return a and b and a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def wrapped(text):
    f, rows = layout(text)
    return dict(size=f.size, rows=rows)  # the page uses the same line breaks, so both look the same


def plan(v, art_url):
    """Everything the Videos page needs to draw the same video live in the browser (video/lyric-video.js)."""
    return dict(
        total=round(v.total, 3), song=round(v.song, 3), first=v.first, roll_start=round(v.roll_start, 3),
        speed=v.speed, end_card=round(v.end_card, 3), notes=v.notes, people=len(v.people),
        looks={k: dict(bg=x[0], ink=x[1], acc=x[2]) for k, x in LOOKS.items()},
        lines=[dict(t=r["t"], next=r["next"], text=r["text"], who=r["who"], section=r["section"],
                    words=[[w, round(t, 3)] for w, t in r["words"]], **wrapped(r["text"])) for r in v.rows],
        credits=[[k, h] for k, h in v.credit_rows],
        art={slot: art_url + os.path.relpath(path, ART).replace(os.sep, "/") for slot, path in v.art.items()},
        mp4="https://github.com/nishal21/nishal21/releases/download/visitor-song/visitor-song.mp4",
    )


NAME = ["visitor"]


def main():
    """OUT [--web] [--lrc F --json F --mp3 F] [--frames t1,t2]
    --web writes what the Videos page plays live: visitor-video.json (the plan), visitor-video.mp3 (the song with a
    quiet tail for the credits roll) and visitor-poster.jpg. Without it, the MP4 is rendered too (for the release)."""
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else "."
    opt = {args[i][2:]: args[i + 1] for i in range(len(args) - 1) if args[i].startswith("--") and not args[i + 1].startswith("--")}
    lrc = opt.get("lrc", os.path.join(ASSETS, "visitor-song.lrc"))
    js = opt.get("json", os.path.join(ASSETS, "visitor-song.json"))
    mp3 = opt.get("mp3", os.path.join(ASSETS, "visitor-song.mp3"))
    if not os.path.exists(mp3):
        sys.exit("visitor-song.mp3 not found")
    os.makedirs(out, exist_ok=True)
    NAME[0] = opt.get("name", "visitor")
    data, rows, length = load(lrc, js, mp3)
    v = Video(data, rows, length)
    if "frames" in opt:  # stills for checking
        for s in opt["frames"].split(","):
            v.frame(float(s)).save(os.path.join(out, f"frame-{float(s):06.2f}.png"))
        return
    t0 = time.time()
    v.frame(max(0.5, v.first - 1.2)).resize((1280, 720), Image.LANCZOS).save(os.path.join(out, f"{NAME[0]}-poster.jpg"), quality=86)
    if "--web" in args:
        # link preview card (1200x630): the title frame, with the current line and visitor counts
        big = v.frame(max(0.5, v.first - 1.2))
        big.crop((0, 36, 1920, 1044)).resize((1200, 630), Image.LANCZOS).save(os.path.join(out, f"{NAME[0]}-og.jpg"), quality=88)
        with open(os.path.join(out, f"{NAME[0]}-video.json"), "w") as f:
            json.dump(plan(v, "../player/art/"), f, separators=(",", ":"))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-af", f"apad,atrim=0:{v.total:.3f}",
                        "-c:a", "libmp3lame", "-b:a", "160k", os.path.join(out, f"{NAME[0]}-video.mp3")], check=True)
        print(f"{out}/{NAME[0]}-video.json and .mp3 written ({v.total:.1f} s, {len(rows)} lines)")
        return
    n = int(math.ceil(v.total * FPS))
    target = os.path.join(out, "visitor-song.mp4")
    # light grain only: heavy per-frame noise is what makes a flat-colour video big
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", mp3,
           "-filter_complex", f"[0:v]noise=c0s=3:c0f=t,format=yuv420p[v];[1:a]apad,atrim=0:{v.total:.3f}[a]",
           "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-tune", "animation",
           "-x264-params", "keyint=96", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-t", f"{v.total:.3f}", target]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    clashes = 0
    for i in range(n):
        fr = v.frame(i / FPS)
        if v.box_drawn and any(overlaps(v.box_drawn, b) for b in v.box_text):
            clashes += 1
        p.stdin.write(fr.tobytes())
    p.stdin.close()
    if p.wait():
        sys.exit("ffmpeg failed")
    print(f"{target}: {v.total:.1f} s, {len(rows)} lines, {len(v.art)} drawings, {clashes} overlapping frames, "
          f"{os.path.getsize(target) / 1e6:.1f} MB, rendered in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
