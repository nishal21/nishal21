"""The video page's library: the channel's latest uploads from its public RSS feed (no API key).

  python3 scripts/youtube_videos.py              fetch the feed into assets/videos.json
  python3 scripts/youtube_videos.py site <dir>   copy videos.json into the site and save small thumbnails

The feed only lists the 15 newest uploads. If it can't be read, assets/videos.json keeps the last
good copy (the nightly job commits it), so the page never loses its library.
"""
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from common import http_get, write_atomic

CHANNEL_ID = "UCBgeszZt59TcJed1YCExp4g"  # youtube.com/@DemonKing0.___
HANDLE = "@DemonKing0.___"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "videos.json")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}
ID = re.compile(r"^[\w-]{11}$")


def clean_title(t):
    t = re.sub(r"([\s,]*#[\w\u0080-\uffff]+)+[\s,]*$", "", t)  # trailing hashtags
    t = re.sub(r"\s*\|\s*", " | ", t)
    return " ".join(t.split()).strip(" |")


CHAP = re.compile(r"^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*(?:[-\u2013\u2014:|.]\s*)?(.+?)\s*$")


def chapters(desc):
    """Chapters the way YouTube finds them: timestamps at line starts, the first at 0:00, at least three, rising."""
    out = []
    for line in desc.splitlines():
        m = CHAP.match(line)
        if not m:
            continue
        secs = 0
        for part in m.group(1).split(":"):
            secs = secs * 60 + int(part)
        title = m.group(2).strip(" -|")[:100]
        if title and (not out or secs > out[-1]["t"]):
            out.append({"t": secs, "title": title})
    if len(out) < 3 or out[0]["t"] != 0:
        return None
    return out


def fetch():
    root = ET.fromstring(http_get(FEED))
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", namespaces=NS) or ""
        if not ID.match(vid):
            continue
        g = e.find("media:group", NS)
        link = e.find("a:link", NS)
        stats = g.find("media:community/media:statistics", NS) if g is not None else None
        views = stats.get("views") if stats is not None else None
        desc = (g.findtext("media:description", namespaces=NS) if g is not None else "") or ""
        out.append(dict(
            id=vid,
            title=clean_title(e.findtext("a:title", namespaces=NS) or ""),
            published=e.findtext("a:published", namespaces=NS),
            thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            views=int(views) if views and views.isdigit() else None,
            isShort="/shorts/" in (link.get("href") if link is not None else ""),
            description=desc.strip()[:700],
        ))
        ch = chapters(desc)
        if ch:
            out[-1]["chapters"] = ch
    if not out:
        raise RuntimeError("feed has no entries")
    return dict(channel=dict(id=CHANNEL_ID, handle=HANDLE, name=root.findtext("a:title", namespaces=NS) or "",
                             url=f"https://www.youtube.com/{HANDLE}"),
                updated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), videos=out)


def palette(img):
    """Two dominant colours, most vivid first, for the ambient light when the frame itself can't be read."""
    import colorsys
    raw = img.resize((24, 24)).tobytes()
    buckets = {}
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        if max(r, g, b) < 28:
            continue
        k = (r >> 5, g >> 5, b >> 5)
        e = buckets.setdefault(k, [0, 0, 0, 0])
        e[0] += r; e[1] += g; e[2] += b; e[3] += 1
    if not buckets:
        return ["#202020", "#101010"]
    avg = [(e[0] // e[3], e[1] // e[3], e[2] // e[3], e[3]) for e in buckets.values()]
    def score(c):
        h, l, s = colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)
        return c[3] * (0.35 + s) * (1 - abs(l - 0.5))
    avg.sort(key=score, reverse=True)
    pick = [avg[0]] + [c for c in avg[1:] if sum(abs(c[i] - avg[0][i]) for i in range(3)) > 90][:1]
    if len(pick) < 2:
        pick.append(avg[1] if len(avg) > 1 else avg[0])
    return ["#%02x%02x%02x" % c[:3] for c in pick]


STATE = {}


def storyboard_frames(vid):
    """The player's own preview frames (the ones YouTube shows while scrubbing), if the watch page
    hands them out. Returns (frames, seconds per frame) or None. YouTube often answers servers with
    a bot check instead of the page; then the caller falls back to the automatic thumbnails."""
    from PIL import Image
    try:
        html = http_get(f"https://www.youtube.com/watch?v={vid}&hl=en", headers={"Accept-Language": "en"}, timeout=15, tries=1).decode("utf-8", "replace")
    except Exception:
        return None
    length = re.search(r'"lengthSeconds":"(\d+)"', html)
    length = int(length.group(1)) if length else 0
    STATE["length"] = length
    m = re.search(r'"playerStoryboardSpecRenderer":\{"spec":"([^"]+)"', html)
    if not m:
        return None
    parts = m.group(1).encode().decode("unicode_escape").split("|")
    base, levels = parts[0], [p.split("#") for p in parts[1:]]
    usable = [(i, l) for i, l in enumerate(levels) if len(l) >= 8 and int(l[0]) >= 48]
    if not usable:
        return None
    L, (w, h, count, cols, rows, interval, name, sigh) = usable[min(1, len(usable) - 1)][0], usable[min(1, len(usable) - 1)][1][:8]
    w, h, count, cols, rows, interval = int(w), int(h), int(count), int(cols), int(rows), int(interval)
    step = interval / 1000 if interval else (length / count if length and count else 0)
    if not step or not count:
        return None
    per = cols * rows
    frames = []
    for sheet in range((count + per - 1) // per):
        url = base.replace("$L", str(L)).replace("$N", name.replace("$M", str(sheet)))
        url += ("&" if "?" in url else "?") + "sigh=" + sigh
        try:
            img = Image.open(io.BytesIO(http_get(url, tries=1))).convert("RGB")
        except Exception:
            return frames and (frames, step) or None
        for k in range(per):
            if len(frames) >= count:
                break
            x, y = (k % cols) * w, (k // cols) * h
            if y + h > img.height:
                break
            frames.append(img.crop((x, y, x + w, y + h)))
    return (frames, step) if frames else None


def ambient_track(v, site, first):
    """A small sprite of frames over time for the ambient light in Light mode: storyboard frames
    every few seconds when available, otherwise the thumbnail plus YouTube's three automatic
    frames (about 25, 50 and 75 % in)."""
    from PIL import Image
    STATE.clear()
    got = storyboard_frames(v["id"])
    if STATE.get("length"):
        v["duration"] = STATE["length"]
    unit_step = 0
    if got:
        frames, unit_step = got
        if len(frames) > 400:  # keep the sprite small: thin out long videos
            k = len(frames) / 400
            frames = [frames[int(i * k)] for i in range(400)]
            unit_step *= k
    else:
        frames = [first]
        for q in ("mq1", "mq2", "mq3"):
            try:
                frames.append(Image.open(io.BytesIO(http_get(f"https://i.ytimg.com/vi/{v['id']}/{q}.jpg", tries=2))).convert("RGB"))
            except Exception:
                break
    tw, th = (36, 64) if v["isShort"] else (64, 36)
    cols = min(10, len(frames))
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, th * rows))
    for i, f in enumerate(frames):
        fw, fh = f.size
        if v["isShort"] and fw > fh:  # Shorts come pillarboxed in 16:9 frames
            cw = int(fh * 9 / 16)
            f = f.crop(((fw - cw) // 2, 0, (fw - cw) // 2 + cw, fh))
        sheet.paste(f.resize((tw, th), Image.BILINEAR), ((i % cols) * tw, (i // cols) * th))
    name = f"thumbs/{v['id']}-amb.jpg"
    sheet.save(os.path.join(site, name), "JPEG", quality=70, optimize=True)
    v["amb"] = dict(sprite=name, w=tw, h=th, cols=cols, n=len(frames), step=round(unit_step, 3),
                    source="storyboard" if got else "thumbnails")


def thumbs(data, site):
    """Small local copies, so the page loads them from its own origin (no third-party request
    until someone presses play). Videos get 640x360, Shorts a 360x640 centre crop."""
    from PIL import Image
    d = os.path.join(site, "thumbs")
    os.makedirs(d, exist_ok=True)
    for v in data["videos"]:
        img = None
        for q in ("hq720", "hqdefault"):
            try:
                img = Image.open(io.BytesIO(http_get(f"https://i.ytimg.com/vi/{v['id']}/{q}.jpg", tries=2))).convert("RGB")
                break
            except Exception:
                continue
        if img is None:
            continue
        w, h = img.size
        if q == "hqdefault":  # 4:3 with bars: keep the 16:9 middle
            ch = int(w * 9 / 16)
            img = img.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
            w, h = img.size
        if v["isShort"]:
            cw = int(h * 9 / 16)
            img = img.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h)).resize((360, 640), Image.LANCZOS)
        else:
            img = img.resize((640, 360), Image.LANCZOS)
        v["colors"] = palette(img)
        try:
            ambient_track(v, site, img)
        except Exception as e:
            print(f"{v['id']}: no ambient track ({e})")
        img.save(os.path.join(d, f"{v['id']}.jpg"), "JPEG", quality=76, optimize=True, progressive=True)
        v["thumb"] = f"thumbs/{v['id']}.jpg"


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "site":
        site = sys.argv[2]
        os.makedirs(site, exist_ok=True)
        try:
            with open(OUT) as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = dict(channel=dict(handle=HANDLE, url=f"https://www.youtube.com/{HANDLE}"), videos=[])
        try:
            thumbs(data, site)
        except Exception as e:  # remote thumbnails still work
            print(f"thumbnails not saved: {e}")
        with open(os.path.join(site, "videos.json"), "w") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{site}/videos.json: {len(data['videos'])} videos")
        return
    data = fetch()
    write_atomic(OUT, json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"{OUT}: {len(data['videos'])} videos, {sum(v['isShort'] for v in data['videos'])} Shorts")


if __name__ == "__main__":
    main()
