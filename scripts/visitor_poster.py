"""Shareable posters for each visitor whose note made it into the visitor song.

Each poster sets the visitor's lyric line(s) big, with "lyric by @username" and their GitHub avatar, which line of the
song it is and the date, a QR code to the exact second it plays, and an Open Doodle. Four sizes:
story 1080x1920 (IG, WhatsApp, Snap; key content kept out of the top and bottom UI bands), feed 1080x1350,
square 1080x1080 and wide 1200x630 (X, LinkedIn, link previews).

Every visitor gets their own look: a layout, a palette and a drawing picked from their username and issue number, so
a rebuild gives the same poster, and no two visitors share the same drawing + layout + palette (the drawing itself
is kept unique for as long as there are unused ones).

Usage: visitor_poster.py OUT_DIR [--state data/visitor-song.json] [--only ISSUE] [--missing] [--no-avatar]
Writes OUT_DIR/<issue>-<size>.jpg.
"""
import hashlib
import io
import json
import os
import sys
import urllib.request
from datetime import datetime

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import visitor_video as VV  # noqa: E402  (fonts, drawings)
import visitor_song as VS  # noqa: E402  (where each line plays)

USER = "nishal21"
SITE = f"https://{USER}.github.io/{USER}"
SIZES = {"story": (1080, 1920), "feed": (1080, 1350), "square": (1080, 1080), "wide": (1200, 630)}

INK, PAPER, LIME, PINK = (17, 17, 17), (243, 239, 229), (227, 251, 29), (255, 86, 120)
COBALT, NIGHT, CLAY, MINT = (38, 64, 214), (22, 22, 24), (232, 106, 58), (164, 230, 196)
PALETTES = [  # (background, ink, accent): flat and bold, always readable
    (PAPER, INK, PINK), (LIME, INK, PINK), (NIGHT, PAPER, LIME), (PINK, INK, PAPER),
    (COBALT, PAPER, LIME), (CLAY, INK, PAPER), (MINT, INK, COBALT), (INK, LIME, PINK),
]
LAYOUTS = ["stack", "doodle-top", "framed", "split"]


def h(*parts):
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest(), 16)


def assign(entries):
    """(layout, palette, drawing) per issue, in the order visitors arrived, so earlier posters never change."""
    pool = VV.doodles(10_000)
    used_combo, used_art, out = set(), set(), {}
    n_pal, n_lay = [0] * len(PALETTES), [0] * len(LAYOUTS)
    for e in entries:
        seed = h(e["user"].lower(), e["issue"])
        arts = sorted(range(len(pool)), key=lambda i: h(seed, "art", i))
        fresh = [i for i in arts if i not in used_art] or arts
        # the least used layout and palette first (ties broken by the visitor's own hash), so looks spread out
        lays = sorted(range(len(LAYOUTS)), key=lambda i: (n_lay[i], h(seed, "lay", i)))
        pals = sorted(range(len(PALETTES)), key=lambda i: (n_pal[i], h(seed, "pal", i)))
        pick = next(((a, li, pi) for a in fresh for li in lays for pi in pals if (a, li, pi) not in used_combo),
                    (arts[0], lays[0], pals[0]))
        used_combo.add(pick)
        used_art.add(pick[0])
        n_lay[pick[1]] += 1
        n_pal[pick[2]] += 1
        out[e["issue"]] = dict(layout=LAYOUTS[pick[1]], palette=PALETTES[pick[2]], art=pool[pick[0]])
    return out


def avatar(user, size, fetch=True):
    im = None
    if fetch:
        try:
            req = urllib.request.Request(f"https://github.com/{user}.png?size={size * 2}", headers={"User-Agent": f"{USER}-visitor-song"})
            with urllib.request.urlopen(req, timeout=15) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:  # noqa: BLE001
            im = None
    if im is None:  # a plain disc with their initial
        im = Image.new("RGB", (size, size), (200, 200, 200))
        d = ImageDraw.Draw(im)
        f = VV.font(int(size * 0.55))
        d.text((size / 2, size / 2), user[:1].upper(), font=f, fill=INK, anchor="mm")
    im = im.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return im, mask.resize((size, size), Image.LANCZOS)


def qr(url, px, ink, bg):
    import qrcode
    q = qrcode.QRCode(border=0, error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(url)
    q.make(fit=True)
    im = q.make_image(fill_color=ink, back_color=bg).convert("RGB")
    return im.resize((px, px), Image.NEAREST)


def fit_text(text, width, max_rows, sizes):
    for s in sizes:
        f = VV.font(s)
        rows = VV.wrap(text.split(), f, width)
        if len(rows) <= max_rows:
            return f, rows
    f = VV.font(sizes[-1])
    return f, VV.wrap(text.split(), f, width)


def text_block(d, lines, box, colour, max_size):
    """Each lyric line as its own block, sized to fill the box. Returns the height used."""
    x, y, w, hgt = box
    sizes = [s for s in range(max_size, 30, -6)]
    for s in sizes:
        f = VV.font(s)
        rows = [r for ln in lines for r in VV.wrap(ln.split(), f, w)]
        gap = int(s * 0.45) * (len(lines) - 1)
        total = int(s * 1.06) * len(rows) + gap
        if total <= hgt:
            break
    yy = y
    for i, ln in enumerate(lines):
        for r in VV.wrap(ln.split(), f, w):
            d.text((x, yy), " ".join(r), font=f, fill=colour)
            yy += int(s * 1.06)
        yy += int(s * 0.45)
    return yy - y


def grain(im, amount=10):
    noise = Image.effect_noise(im.size, 64).point(lambda v: 128 + (v - 128) * amount // 64)
    return Image.blend(im, Image.merge("RGB", (noise, noise, noise)), 0.06)


def drawing(path, look, box_w, box_h):
    bg, ink, acc = look
    im = VV.raster(path, ink, acc, box_w, box_h)
    return im


def render(e, info, n, when, size, fetch_avatar=True):
    W, H = SIZES[size]
    bg, ink, acc = info["palette"]
    layout = info["layout"]
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    lines = VS.lines_of(e)
    t = n["t"]
    url = f"{SITE}/video/?v=visitor&t={int(t)}"
    # safe area: stories keep 250 px at the top and 340 px at the bottom free for the app's own UI
    pad = 72 if size != "wide" else 56
    top = 250 if size == "story" else pad
    bottom = H - (340 if size == "story" else pad)
    left, right = pad, W - pad
    wide = size == "wide"

    # the mark
    d.text((left, top), "nishal21 · visitor song", font=VV.font(26 if not wide else 22, "Medium", True), fill=ink)

    # where the drawing and the words go
    if wide:
        art_box = (int(W * 0.62), top + 40, right, bottom - 10)
        text_box = (left, top + 70, int(W * 0.58) - left, bottom - top - 220)
    elif layout == "doodle-top":
        art_box = (left + 80, top + 60, right - 80, top + int((bottom - top) * 0.36))
        text_box = (left, art_box[3] + 40, right - left, bottom - art_box[3] - 330)
    elif layout == "split":
        cut = top + int((bottom - top) * 0.42)
        d.rectangle((0, top + 50, W, cut), fill=acc)
        art_box = (left + 40, top + 70, right - 40, cut - 20)
        text_box = (left, cut + 50, right - left, bottom - cut - 380)
    elif layout == "framed":
        d.rectangle((left - 24, top + 54, right + 24, bottom + 0), outline=ink, width=6)
        art_box = (int(W * 0.58), bottom - 300 - int((bottom - top) * 0.22), right - 20, bottom - 300)
        text_box = (left + 24, top + 110, right - left - 48, art_box[1] - top - 140)
    else:  # stack: words top-left, drawing lower right
        art_box = (int(W * 0.45), bottom - 290 - int((bottom - top) * 0.3), right, bottom - 290)
        text_box = (left, top + 90, right - left, art_box[1] - top - 120)

    # the drawing (recoloured to this palette; on the split band it takes the band's colours)
    look = (acc, ink, bg) if layout == "split" and not wide else (bg, ink, acc)
    art = drawing(info["art"], look, art_box[2] - art_box[0], art_box[3] - art_box[1])
    ax = art_box[0] + (art_box[2] - art_box[0] - art.width) // 2
    ay = art_box[1] + (art_box[3] - art_box[1] - art.height) // 2
    im.paste(art.convert("RGB"), (ax, ay), art.getchannel("A"))

    # the lyric
    max_size = {"story": 140, "feed": 124, "square": 108, "wide": 72}[size]
    used = text_block(d, lines, text_box, ink, max_size)

    # credit: avatar + lyric by @user
    cy = text_box[1] + used + (10 if not wide else 0)
    av = 84 if not wide else 64
    a_im, a_mask = avatar(e["user"], av, fetch_avatar)
    d.ellipse((left - 4, cy - 4, left + av + 4, cy + av + 4), fill=acc if layout != "split" else ink)
    im.paste(a_im, (left, cy), a_mask)
    d.text((left + av + 22, cy + 4), "lyric by", font=VV.font(22 if not wide else 18, "Medium", True), fill=ink)
    uname = "@" + e["user"]
    us = 40 if not wide else 30
    maxw = (right - left - av - 22 - 170 - 40) if not wide else (text_box[2] - av - 22)
    while us > 20 and VV.font(us, "Bold").getlength(uname) > maxw:
        us -= 2
    d.text((left + av + 22, cy + (34 if not wide else 26)), uname, font=VV.font(us, "Bold"), fill=ink)

    # foot: which line and when, the QR and the link
    qs = 170 if not wide else 120
    qx, qy = right - qs, bottom - qs
    d.rectangle((qx - 14, qy - 14, right + 14, bottom + 14), fill=PAPER if bg != PAPER else (255, 255, 255))
    im.paste(qr(url, qs, INK, PAPER if bg != PAPER else (255, 255, 255)), (qx, qy))
    fs = VV.font(24 if not wide else 20, "Medium", True)
    which = f"line {n['k']} of the visitor song" + (f" (and {n['k'] + 1})" if len(lines) > 1 else "")
    d.text((left, bottom - (96 if not wide else 70)), which, font=fs, fill=ink)
    d.text((left, bottom - (60 if not wide else 44)), f"{when} · plays at {int(t) // 60}:{int(t) % 60:02d}", font=fs, fill=ink)
    d.text((left, bottom - (24 if not wide else 18)), f"{USER}.github.io/{USER}/video/?v=visitor", font=VV.font(20 if not wide else 16, "Regular", True), fill=ink)
    return grain(im)


def where(entries):
    """issue -> (1-based line number of their first line, time it plays)."""
    out = {}
    for k, (_, _, _, e, t) in enumerate(VS.timed_sheet(entries), 1):
        if e and e["issue"] not in out:
            out[e["issue"]] = dict(k=k, t=t)
    return out


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else "posters"
    opt = {args[i][2:]: args[i + 1] for i in range(len(args) - 1) if args[i].startswith("--") and not args[i + 1].startswith("--")}
    with open(opt.get("state", VS.STATE)) as f:
        state = json.load(f)
    entries = state["entries"]
    looks, at = assign(entries), where(entries)
    os.makedirs(out, exist_ok=True)
    for e in entries:
        if not VS.lines_of(e) or ("only" in opt and str(e["issue"]) != opt["only"]):
            continue
        if "--missing" in args and all(os.path.exists(os.path.join(out, f"{e['issue']}-{z}.jpg")) for z in SIZES):
            continue  # posters are made once; a rebuild never changes someone's poster
        when = datetime.strptime(e.get("added", "2026-01-01"), "%Y-%m-%d").strftime("%-d %b %Y")
        for size in SIZES:
            p = os.path.join(out, f"{e['issue']}-{size}.jpg")
            render(e, looks[e["issue"]], at[e["issue"]], when, size, "--no-avatar" not in args).save(p, quality=86, optimize=True, progressive=True)
        print(f"posters for #{e['issue']} @{e['user']}: {looks[e['issue']]['layout']}, {os.path.basename(looks[e['issue']]['art'])}")


if __name__ == "__main__":
    main()
