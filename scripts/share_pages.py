"""Static share pages, so a shared link shows the right preview card.

Link crawlers (X, WhatsApp, LinkedIn, Slack...) don't run JavaScript, and GitHub Pages serves the same file whatever
the query string, so /video/?v=visitor would always show the Videos page's own card. Each video and song gets its own
small page with its own title, description, 1200x630 image and player card, which then opens the real player with
the same options (t=, embed=1 and the rest are passed through):

  /video/visitor/  /video/clip/  /video/trailer/  /video/yt/<id>/   ->  /video/?v=<key>&...
  /player/visitor/                                                  ->  /player/?song=visitor&...

Usage: share_pages.py SITE_DIR   (run at the end of build_site.sh)
"""
import html
import json
import os
import sys

BASE = "https://nishal21.github.io/nishal21"


def page(path, title, desc, image, target, kind="video.other", player=None, img_size=(1200, 630)):
    e = html.escape
    url = f"{BASE}/{path}"
    tags = [
        f'<meta property="og:type" content="{kind}">', f'<meta property="og:site_name" content="Nishal K">',
        f'<meta property="og:title" content="{e(title)}">', f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:url" content="{url}">', f'<meta property="og:image" content="{e(image)}">',
        f'<meta property="og:image:width" content="{img_size[0]}">', f'<meta property="og:image:height" content="{img_size[1]}">',
        f'<meta name="twitter:title" content="{e(title)}">', f'<meta name="twitter:description" content="{e(desc)}">',
        f'<meta name="twitter:image" content="{e(image)}">',
    ]
    if player:
        tags += ['<meta name="twitter:card" content="summary_large_image">', f'<meta name="twitter:player" content="{e(player)}">',
                 '<meta name="twitter:player:width" content="1280">', '<meta name="twitter:player:height" content="720">',
                 f'<meta property="og:video" content="{e(player)}">', f'<meta property="og:video:secure_url" content="{e(player)}">',
                 '<meta property="og:video:type" content="text/html">',
                 '<meta property="og:video:width" content="1280">', '<meta property="og:video:height" content="720">']
    else:
        tags.append('<meta name="twitter:card" content="summary_large_image">')
    # the player's own options ride along: ?t=43, ?embed=1, &amp; from pasted HTML is tidied first
    script = ("var q=location.search.replace(/&amp;/gi,'&').replace(/^\\?/,'');"
              f"location.replace({json.dumps(target)}+(q?'&'+q:'')+location.hash);")
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
{chr(10).join(tags)}
<meta name="viewport" content="width=device-width,initial-scale=1">
<noscript><meta http-equiv="refresh" content="0;url={e(target)}"></noscript>
<script>{script}</script>
</head><body><p><a href="{e(target)}">{e(title)}</a></p></body></html>
"""
    out = os.path.join(SITE, path)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write(doc)


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    global SITE
    SITE = sys.argv[1] if len(sys.argv) > 1 else "_site"
    n = 0
    vis = load(os.path.join(SITE, "video", "visitor-video.json"))
    song = load(os.path.join(SITE, "player", "visitor-song.json")) or {}
    if vis:
        lines, people = len(vis["lines"]), vis["people"]
        notes = song.get("stats", {}).get("total", vis.get("notes", 0))
        desc = (f"A song made by people who visit my GitHub profile: {lines} lyric lines, {notes} note{'s' if notes != 1 else ''} from "
                f"{people} visitor{'s' if people != 1 else ''} so far. Each line credited by name. It grows every night.")
        img = f"{BASE}/video/visitor-og.jpg"
        page("video/visitor/", "Visitor song · the lyric video", desc, img, "../?v=visitor",
             player=f"{BASE}/video/?embed=1&v=visitor")
        page("player/visitor/", "Visitor song · Nishal K", desc, img, "../?song=visitor", kind="music.song")
        n += 2
    if os.path.exists(os.path.join(SITE, "player", "share-clip.mp4")):
        page("video/clip/", "Contribution song, busiest week · Nishal K",
             "A 15 second clip of my contribution song: the busiest week of the year, rebuilt every night.",
             f"{BASE}/player/og.png", "../?v=clip", player=f"{BASE}/video/?embed=1&v=clip")
        n += 1
    tr = load(os.path.join(SITE, "video", "trailer.json"))
    if tr and tr.get("length"):
        img = f"{BASE}/video/trailer-poster.jpg" if os.path.exists(os.path.join(SITE, "video", "trailer-poster.jpg")) else f"{BASE}/player/og.png"
        page("video/trailer/", "My year on GitHub · Nishal K", "My year on GitHub, cut to the contribution song.",
             img, "../?v=trailer", player=f"{BASE}/video/?embed=1&v=trailer")
        n += 1
    lib = load(os.path.join(SITE, "video", "videos.json")) or {}
    for v in lib.get("videos", []):
        vid = str(v.get("id", ""))
        if not vid or not all(c.isalnum() or c in "-_" for c in vid):
            continue
        title = (v.get("title") or "Video").strip()
        desc = (v.get("description") or "").strip().split("\n")[0][:200] or "A video by DemonKing, on Nishal K's video page."
        page(f"video/yt/{vid}/", title, desc, f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", f"../../?v={vid}",
             player=f"{BASE}/video/?embed=1&v={vid}", img_size=(480, 360))
        n += 1
    print(f"{n} share pages written")


if __name__ == "__main__":
    main()
