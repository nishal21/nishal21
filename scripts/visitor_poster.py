"""Shareable posters for each visitor whose note made it into the visitor song.

Each poster sets the visitor's lyric line(s) big, with "lyric by @username" and their GitHub avatar, which line of the
song it is and the date, a QR code to the exact second it plays, and an Open Doodle. Four sizes:
story 1080x1920 (IG, WhatsApp, Snap; key content kept out of the top and bottom UI bands), feed 1080x1350,
square 1080x1080 and wide 1200x630 (X, LinkedIn, link previews).

Every visitor gets their own look: a layout, a palette and a drawing picked from their username and issue number, so
a rebuild gives the same poster, and no two visitors share the same drawing + layout + palette (the drawing itself
is kept unique for as long as there are unused ones).

Usage: visitor_poster.py OUT_DIR [--state data/visitor-song.json] [--only ISSUE] [--missing] [--no-avatar] [--release]
Writes OUT_DIR/<issue>-<size>.jpg. With --release (the nightly workflow), posters live on GitHub releases instead of
in the repo: each visitor without one gets theirs rendered and uploaded with gh to "visitor-posters-<n>" (200
visitors per release, 4 files each, well under the 1000-asset limit), and the tag is saved on their entry in the
state file so the reply can link to it. Posters are made once and never re-encoded.
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


def text_block(d, lines, box, colour, max_size, rec):
    """Each lyric line as its own block, sized to fill the box. Returns the height used."""
    x, y, w, hgt = box
    for s in range(max_size, 27, -4):
        f = VV.font(s)
        rows = [r for ln in lines for r in VV.wrap(ln.split(), f, w)]
        if int(s * 1.06) * len(rows) + int(s * 0.45) * (len(lines) - 1) <= hgt:
            break
    yy = y
    for ln in lines:
        for r in VV.wrap(ln.split(), f, w):
            txt = " ".join(r)
            d.text((x, yy), txt, font=f, fill=colour)
            rec("lyric", d.textbbox((x, yy), txt, font=f))
            yy += int(s * 1.06)
        yy += int(s * 0.45)
    return yy - int(s * 0.45) - y


def grain(im, amount=10):
    noise = Image.effect_noise(im.size, 64).point(lambda v: 128 + (v - 128) * amount // 64)
    return Image.blend(im, Image.merge("RGB", (noise, noise, noise)), 0.06)


M = 48  # nothing comes closer than this to an edge, a frame line or a colour band


def fit_mono(text, size, width, weight="Medium"):
    while size > 12 and VV.font(size, weight, True).getlength(text) > width:
        size -= 1
    return VV.font(size, weight, True)


def render(e, info, n, when, size, fetch_avatar=True, check=None):
    W, H = SIZES[size]
    bg, ink, acc = info["palette"]
    layout = info["layout"]
    wide = size == "wide"
    if wide and layout == "framed":
        layout = "stack"  # too short for a frame
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    lines = VS.lines_of(e)
    t = n["t"]
    url = f"{SITE}/video/?v=visitor&t={int(t)}"
    boxes, limits = [], []

    def rec(name, b, area=None):
        boxes.append((name, tuple(int(v) for v in b), area))

    # safe area: stories keep 250 px at the top and 340 px at the bottom free for the app's own UI
    pad = 72 if not wide else 56
    top = 250 if size == "story" else pad
    bottom = H - (340 if size == "story" else pad)
    left, right = pad, W - pad
    canvas_area = (M, M, W - M, H - M)

    # the mark, above everything (and above the frame)
    mf = VV.font(26 if not wide else 22, "Medium", True)
    d.text((left, top), "nishal21 · visitor song", font=mf, fill=ink)
    rec("mark", d.textbbox((left, top), "nishal21 · visitor song", font=mf), canvas_area)
    top += 50 if not wide else 40

    if layout == "framed":
        fw = 6
        frame = (left - 24, top, right + 24, bottom + 24)
        d.rectangle(frame, outline=ink, width=fw)
        left, top, right, bottom = frame[0] + fw + M, frame[1] + fw + M, frame[2] - fw - M, frame[3] - fw - M
    area = (left, top, right, bottom)

    # foot: the QR at the bottom right, three short lines beside it that shrink to fit
    qs = 170 if not wide else 120
    qx, qy = right - qs, bottom - qs
    qbg = PAPER if bg != PAPER else (255, 255, 255)
    d.rectangle((qx - 14, qy - 14, right, bottom), fill=qbg)
    im.paste(qr(url, qs - 14, INK, qbg), (qx, qy))
    rec("qr", (qx - 14, qy - 14, right, bottom), area)
    foot_w = qx - 14 - 28 - left
    which = f"line {n['k']} of the visitor song" + (f" (and {n['k'] + 1})" if len(lines) > 1 else "")
    foot = [(which, fit_mono(which, 24 if not wide else 20, foot_w)),
            (f"{when} · plays at {int(t) // 60}:{int(t) % 60:02d}", None),
            (f"{USER}.github.io/{USER}/video/?v=visitor", None)]
    foot[1] = (foot[1][0], fit_mono(foot[1][0], 24 if not wide else 20, foot_w))
    foot[2] = (foot[2][0], fit_mono(foot[2][0], 20 if not wide else 16, foot_w, "Regular"))
    fy = bottom
    for txt, f in reversed(foot):
        hgt = f.getbbox(txt)[3]
        fy -= hgt + 10
        d.text((left, fy), txt, font=f, fill=ink)
        rec("foot", d.textbbox((left, fy), txt, font=f), area)
    foot_top = min(fy, qy - 14) - 36

    # where the drawing and the words go
    av = 84 if not wide else 64
    credit_h = av + 8
    if wide:
        art_box = (int(W * 0.62), top, right, qy - 14 - 30)
        text_box = (left, top, int(W * 0.58) - left, foot_top - top - credit_h - 24)
    elif layout == "doodle-top":
        cut = top + int((foot_top - top) * 0.40)
        art_box = (left + 60, top, right - 60, cut)
        text_box = (left, cut + 40, right - left, foot_top - cut - 40 - credit_h - 24)
    elif layout == "split":
        cut = top + int((foot_top - top) * 0.42)
        d.rectangle((0, top, W, cut), fill=acc)
        art_box = (left, top + M, right, cut - M)
        text_box = (left, cut + M, right - left, foot_top - cut - M - credit_h - 24)
    else:  # stack and framed: words at the top, the drawing below to the right
        art_top = top + int((foot_top - top) * 0.58)
        art_box = (left + int((right - left) * 0.42), art_top, right, foot_top)
        text_box = (left, top, right - left, art_top - top - credit_h - 40)

    look = (acc, ink, bg) if layout == "split" and not wide else (bg, ink, acc)
    art = VV.raster(info["art"], look[1], look[2], art_box[2] - art_box[0], art_box[3] - art_box[1])
    ax = art_box[0] + (art_box[2] - art_box[0] - art.width) // 2
    ay = art_box[1] + (art_box[3] - art_box[1] - art.height) // 2
    im.paste(art.convert("RGB"), (ax, ay), art.getchannel("A"))
    rec("art", (ax, ay, ax + art.width, ay + art.height), area)

    max_size = {"story": 140, "feed": 124, "square": 108, "wide": 72}[size]
    used = text_block(d, lines, text_box, ink, max_size, lambda nm, b: rec(nm, b, area))

    # credit: avatar + lyric by @user, right under the words
    cy = text_box[1] + used + 24
    a_im, a_mask = avatar(e["user"], av, fetch_avatar)
    d.ellipse((left, cy, left + av + 8, cy + av + 8), fill=acc if layout != "split" else ink)
    im.paste(a_im, (left + 4, cy + 4), a_mask)
    lab = VV.font(22 if not wide else 18, "Medium", True)
    tx = left + av + 30
    d.text((tx, cy + 6), "lyric by", font=lab, fill=ink)
    uname = "@" + e["user"]
    maxw = (text_box[0] + text_box[2]) - tx
    us = 40 if not wide else 30
    while us > 18 and VV.font(us, "Bold").getlength(uname) > maxw:
        us -= 2
    d.text((tx, cy + (36 if not wide else 28)), uname, font=VV.font(us, "Bold"), fill=ink)
    ub = d.textbbox((tx, cy + (36 if not wide else 28)), uname, font=VV.font(us, "Bold"))
    rec("credit", (left, cy, max(ub[2], tx + lab.getlength("lyric by")), max(cy + av + 8, ub[3])), area)

    if check is not None:
        check.extend(problems(boxes, size, e))
    return grain(im)


def problems(boxes, size, e):
    """Every element inside its area (the frame's inner margin or the page margin), and no two elements touching."""
    out = []
    for name, b, area in boxes:
        if area and (b[0] < area[0] or b[1] < area[1] or b[2] > area[2] or b[3] > area[3]):
            out.append(f"#{e['issue']} {size}: {name} {b} outside {area}")
    solid = [(n, b) for n, b, _ in boxes if n != "mark"]
    for i in range(len(solid)):
        for j in range(i + 1, len(solid)):
            (n1, a), (n2, b) = solid[i], solid[j]
            if n1 == n2 and n1 in ("lyric", "foot"):
                continue
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                out.append(f"#{e['issue']} {size}: {n1} {a} overlaps {n2} {b}")
    return out


def where(entries):
    """issue -> (1-based line number of their first line, time it plays)."""
    out = {}
    for k, (_, _, _, e, t) in enumerate(VS.timed_sheet(entries), 1):
        if e and e["issue"] not in out:
            out[e["issue"]] = dict(k=k, t=t)
    return out


PER_RELEASE = 200  # visitors per release: 800 files, under GitHub's 1000 assets per release


def release_tag(entries, e):
    """Stable: entries are only ever appended, so a visitor's place (and release) never changes."""
    k = [x["issue"] for x in entries if VS.lines_of(x)].index(e["issue"])
    return f"visitor-posters-{k // PER_RELEASE + 1}"


def upload(e, out, tag):
    import subprocess
    if subprocess.run(["gh", "release", "view", tag], capture_output=True).returncode:
        subprocess.run(["gh", "release", "create", tag, "--latest=false", "--title", f"Visitor posters {tag.rsplit('-', 1)[1]}",
                        "--notes", "Share posters for people who added lines to the visitor song (scripts/visitor_poster.py)."],
                       check=True)
    files = [os.path.join(out, f"{e['issue']}-{z}.jpg") for z in SIZES]
    subprocess.run(["gh", "release", "upload", tag, *files, "--clobber"], check=True)
    e["poster"] = tag
    if e.get("replied"):
        relink(e, tag)


def relink(e, tag):
    """Posters used to be committed under assets/visitor-posters/; point an earlier reply at the release instead."""
    old = f"https://raw.githubusercontent.com/{USER}/{USER}/main/assets/visitor-posters/{e['issue']}-"
    new = f"https://github.com/{USER}/{USER}/releases/download/{tag}/{e['issue']}-"
    try:
        for c in VS.gh("GET", f"/repos/{USER}/{USER}/issues/{e['issue']}/comments?per_page=100") or []:
            if old in (c.get("body") or ""):
                VS.gh("PATCH", f"/repos/{USER}/{USER}/issues/comments/{c['id']}", {"body": c["body"].replace(old, new)})
                print(f"#{e['issue']}: comment {c['id']} now links to the release")
    except Exception as x:  # noqa: BLE001
        print(f"#{e['issue']}: couldn't update the old comment ({x})")


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else "posters"
    opt = {args[i][2:]: args[i + 1] for i in range(len(args) - 1) if args[i].startswith("--") and not args[i + 1].startswith("--")}
    with open(opt.get("state", VS.STATE)) as f:
        state = json.load(f)
    entries = state["entries"]
    looks, at = assign(entries), where(entries)
    os.makedirs(out, exist_ok=True)
    bad = []
    for e in entries:
        if not VS.lines_of(e) or ("only" in opt and str(e["issue"]) != opt["only"]):
            continue
        if "--release" in args and e.get("poster"):
            continue
        if "--missing" in args and all(os.path.exists(os.path.join(out, f"{e['issue']}-{z}.jpg")) for z in SIZES):
            continue  # posters are made once; a rebuild never changes someone's poster
        when = datetime.strptime(e.get("added", "2026-01-01"), "%Y-%m-%d").strftime("%-d %b %Y")
        for size in SIZES:
            p = os.path.join(out, f"{e['issue']}-{size}.jpg")
            issues = []
            render(e, looks[e["issue"]], at[e["issue"]], when, size, "--no-avatar" not in args, issues).save(p, quality=86, optimize=True, progressive=True)
            bad.extend(issues)
        if "--release" in args and not any(str(e["issue"]) == b.split()[0][1:] for b in bad):
            upload(e, out, release_tag(entries, e))
        print(f"posters for #{e['issue']} @{e['user']}: {looks[e['issue']]['layout']}, {os.path.basename(looks[e['issue']]['art'])}")

    if "--release" in args:
        with open(opt.get("state", VS.STATE), "w") as f:
            json.dump(state, f, indent=1)
    if bad:
        print("\n".join(bad))
        sys.exit(f"{len(bad)} layout problems")


if __name__ == "__main__":
    main()
