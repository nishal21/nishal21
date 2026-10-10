"""Latest YouTube upload card from the channel's public RSS feed (no API key).

The bars on the card are decoration: their heights come from a hash of the video ID,
not from the audio. An image can't hold a link, so the script also rewrites the text link
between the YOUTUBE markers in README.md.
"""
import base64
import hashlib
import io
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime

from common import (ASSETS, CARD_H, CARD_W, FONT, IST, THEMES, card_open, esc, fail, http_get, replace_block,
                    truncate, wrap, write_atomic)

CHANNEL_ID = "UCBgeszZt59TcJed1YCExp4g"  # youtube.com/@DemonKing0.___
HANDLE = "@DemonKing0.___"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
README = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "README.md")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}
EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]")


def latest():
    root = ET.fromstring(http_get(FEED))
    e = root.find("a:entry", NS)
    if e is None:
        raise RuntimeError("feed has no entries")
    g = e.find("media:group", NS)
    stats = g.find("media:community/media:statistics", NS)
    return dict(id=e.find("yt:videoId", NS).text, title=e.find("a:title", NS).text,
                url=e.find("a:link", NS).get("href"), published=e.find("a:published", NS).text,
                thumb=g.find("media:thumbnail", NS).get("url"),
                views=int(stats.get("views")) if stats is not None and stats.get("views") else None,
                author=root.find("a:author/a:name", NS).text)


def clean_title(t):
    t = EMOJI.sub("", t)
    t = re.sub(r"(\s+#\w+)+\s*$", "", t)  # trailing hashtags
    t = re.sub(r"\s*\|\s*", " | ", t)
    return " ".join(t.split())


def thumb_data_uri(url):
    from PIL import Image
    img = Image.open(io.BytesIO(http_get(url))).convert("RGB")
    w, h = img.size
    ch = int(w * 9 / 16)  # hqdefault is 4:3 with bars; crop to 16:9
    top = (h - ch) // 2
    img = img.crop((0, top, w, top + ch)).resize((352, 198), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=72, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def bars(video_id, n):
    h = hashlib.sha256(video_id.encode()).digest()
    h += hashlib.sha256(h).digest()
    vals = [h[i % len(h)] / 255 for i in range(n)]
    # smooth so it reads like a waveform rather than noise
    return [0.25 + 0.75 * (vals[i - 1] + 2 * vals[i] + vals[(i + 1) % n]) / 4 for i in range(n)]


def render(v, thumb, t):
    w, h = CARD_W, CARD_H
    title = clean_title(v["title"])
    when = datetime.fromisoformat(v["published"]).astimezone(IST)
    out = [card_open(t, label=f"Latest YouTube upload: {title}")]
    out.append('<defs><clipPath id="th"><rect x="25" y="52" width="176" height="99" rx="4"/></clipPath></defs>')
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Latest upload</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{esc(v["author"])}</text>')
    out.append(f'<image href="{thumb}" x="25" y="52" width="176" height="99" clip-path="url(#th)" preserveAspectRatio="xMidYMid slice"/>')
    out.append(f'<rect x="25.5" y="52.5" width="175" height="98" rx="4" fill="none" stroke="{t["faint"]}"/>')
    # play button
    out.append('<rect x="96" y="88" width="34" height="24" rx="6" fill="#ff0033" fill-opacity="0.92"/>')
    out.append('<path d="M109 94 L119 100 L109 106 Z" fill="#ffffff"/>')
    if "/shorts/" in v["url"]:
        out.append('<rect x="31" y="58" width="40" height="15" rx="3" fill="#000" fill-opacity="0.65"/>')
        out.append(f'<text x="51" y="69" text-anchor="middle" font-family="{FONT}" font-size="9" font-weight="700" fill="#fff">SHORT</text>')
    x0, colw = 217, w - 25 - 217
    for i, line in enumerate(wrap(title, colw, 13.5, lines=2, bold=True)):
        out.append(f'<text x="{x0}" y="{66 + i*18}" font-family="{FONT}" font-size="13.5" font-weight="600" fill="{t["text"]}">{esc(line)}</text>')
    meta = when.strftime("%b %-d, %Y")
    if v["views"] is not None:
        meta += f" · {v['views']:,} views"
    out.append(f'<text x="{x0}" y="107" font-family="{FONT}" font-size="11.5" fill="{t["muted"]}">{esc(meta)}</text>')
    n, bw = 42, colw / 42
    for i, b in enumerate(bars(v["id"], n)):
        bh = 30 * b
        out.append(f'<rect x="{x0 + i*bw:.1f}" y="{136 - bh/2:.1f}" width="{bw-2:.1f}" height="{bh:.1f}" rx="1.5" fill="{t["icon"]}" fill-opacity="{0.35 + 0.5*b:.2f}"/>')
    out.append(f'<text x="25" y="{h-18}" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{esc(truncate("youtube.com/" + HANDLE, 200, 11))}</text>')
    out.append(f'<text x="{w-25}" y="{h-18}" text-anchor="end" font-family="{FONT}" font-size="11.5" font-weight="600" fill="{t["title"]}">Watch on YouTube ›</text>')
    out.append("</svg>\n")
    return "\n".join(out)


def readme_block(v):
    # The picture is not wrapped in a link: GitHub already links images to the file, and an <a>
    # around <picture> gets split apart by its sanitizer. A text link below carries the video URL.
    title = esc(clean_title(v["title"]))
    return ("<picture>\n"
            '  <source media="(prefers-color-scheme: dark)" srcset="assets/youtube-dark.svg">\n'
            '  <source media="(prefers-color-scheme: light)" srcset="assets/youtube-light.svg">\n'
            f'  <img alt="Latest YouTube upload: {title}" src="assets/youtube-light.svg" height="155">\n'
            "</picture>\n<br>\n"
            f'<a href="{v["url"]}">Watch: {title}</a>')


def main():
    try:
        v = latest()
        thumb = thumb_data_uri(v["thumb"])
    except Exception as e:
        fail(str(e))
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"youtube-{name}.svg"), render(v, thumb, t))
    if os.path.exists(README):
        replace_block(README, "YOUTUBE", readme_block(v))
    print(f"youtube card: {v['id']} {v['published']} {clean_title(v['title'])!r} views={v['views']}")


if __name__ == "__main__":
    main()
