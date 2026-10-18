#!/usr/bin/env bash
# Assemble the GitHub Pages site: the song player, the video page, plus the song files it loads (same origin, so the
# MP3 is served as audio/mpeg and the download attribute works).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/player/fonts
cp player/index.html player/player.css player/player.js player/doodles.js player/remix.js player/remix-worklet.js _site/player/
cp player/fonts/*.woff2 player/fonts/LICENSE.txt _site/player/fonts/
# artwork for the player looks (Open Doodles, CC0, and a public domain letter; see player/art/CREDITS.txt)
mkdir -p _site/player/art && cp -R player/art/. _site/player/art/
for f in contribution-song.mp3 contribution-song.json contribution-song.lrc contribution-song-lyrics.md; do
  cp "assets/$f" _site/player/
done
# The acoustic version (the player's style switch; hidden when it isn't there)
for f in contribution-song-acoustic.mp3 contribution-song-acoustic.json contribution-song-acoustic.lrc; do
  if [ -f "assets/$f" ]; then cp "assets/$f" _site/player/; fi
done
# The visitor song (player.js loads it with ?song=visitor). The MP3 comes from the "Visitor song" step.
for f in visitor-song.mp3 visitor-song.json visitor-song.lrc visitor-song-lyrics.md; do
  if [ -f "assets/$f" ]; then cp "assets/$f" _site/player/; else echo "visitor song: $f missing"; fi
done
# Stems for the remix desk (written by the song step; the page hides the Remix button without them)
if [ -d assets/stems ]; then mkdir -p _site/player/stems && cp assets/stems/* _site/player/stems/; fi
# Cover for link previews and the lock screen (needs Pillow, which the song step already installs).
python3 player/make_cover.py _site/player || echo "cover not built; the page draws its own"
# 15 s vertical video of the busiest week, for sharing (optional: the player hides the link without it)
python3 scripts/share_clip.py _site/player || echo "share clip not built"
# The visitor song's lyric video for the Videos page: drawn live by video/lyric-video.js from visitor-video.json over
# visitor-video.mp3 (needs the MP3 from the "Visitor song" step). The rendered MP4 goes to a release, not the site.
mkdir -p _site/video && python3 scripts/visitor_video.py _site/video --web || echo "visitor video not built"
# The contribution song as a lyric video too, in both styles (the video page's Original / Acoustic switch)
python3 scripts/visitor_video.py _site/video --web --name contribution --lrc assets/contribution-song.lrc \
  --json assets/contribution-song.json --mp3 assets/contribution-song.mp3 || echo "contribution lyric video not built"
if [ -f assets/contribution-song-acoustic.mp3 ]; then
  python3 scripts/visitor_video.py _site/video --web --name contribution-acoustic --lrc assets/contribution-song-acoustic.lrc \
    --json assets/contribution-song-acoustic.json --mp3 assets/contribution-song-acoustic.mp3 || echo "acoustic lyric video not built"
fi
# The video page: the year trailer, the share clip, the YouTube library (videos.json, refreshed nightly into assets/
# and kept from the last good run if the feed fails) and a player for any link.
mkdir -p _site/video
cp -R video/. _site/video/
python3 scripts/youtube_videos.py site _site/video || echo "video library not built; the page still plays links"
# Year trailer: a 45 s edit of the song with the year's numbers, cut on the beat (wide and vertical)
python3 scripts/year_trailer.py video _site/video --site _site/player || echo "year trailer not built"
if [ -f _site/player/share-clip.mp4 ]; then
  ffmpeg -loglevel error -y -ss 1 -i _site/player/share-clip.mp4 -frames:v 1 -vf scale=540:-2 -q:v 4 _site/video/clip-poster.jpg \
    || echo "clip poster not built"
fi
# One small page per video and song with its own link preview (crawlers ignore ?v= and don't run JS)
python3 scripts/share_pages.py _site || echo "share pages not built"
# Cache busting: point the pages at ?v=<hash of each file> so a deploy reaches browsers at once instead of
# after GitHub Pages' 10-minute cache, and give the video page's service worker a new cache name.
h() { if [ -f "$1" ]; then sha1sum "$1" | cut -c1-10; else echo none; fi; }
sed -i "s/lyric-video\.js?v=dev/lyric-video.js?v=$(h _site/video/lyric-video.js)/" _site/video/video.js
sed -i -e "s/video\.css?v=dev/video.css?v=$(h _site/video/video.css)/" \
       -e "s/video\.js?v=dev/video.js?v=$(h _site/video/video.js)/" \
       -e "s/menu\.css?v=dev/menu.css?v=$(h _site/video/menu.css)/" \
       -e "s/menu\.js?v=dev/menu.js?v=$(h _site/video/menu.js)/" \
       -e "s/gestures\.js?v=dev/gestures.js?v=$(h _site/video/gestures.js)/" \
       -e "s/videos\.json?v=dev/videos.json?v=$(h _site/video/videos.json)/" _site/video/index.html
sed -i -e "s/player\.css?v=dev/player.css?v=$(h _site/player/player.css)/" \
       -e "s/player\.js?v=dev/player.js?v=$(h _site/player/player.js)/" \
       -e "s/doodles\.js?v=dev/doodles.js?v=$(h _site/player/doodles.js)/" \
       -e "s/remix\.js?v=dev/remix.js?v=$(h _site/player/remix.js)/" \
       -e "s/menu\.css?v=dev/menu.css?v=$(h _site/video/menu.css)/" \
       -e "s/menu\.js?v=dev/menu.js?v=$(h _site/video/menu.js)/" _site/player/index.html
sed -i "s/remix-worklet\.js?v=dev/remix-worklet.js?v=$(h _site/player/remix-worklet.js)/" _site/player/remix.js
sed -i "s/^const BUILD = \"dev\";/const BUILD = \"$(cat _site/video/index.html _site/video/sw.js | sha1sum | cut -c1-10)\";/" _site/video/sw.js
cat > _site/index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>Contribution song</title>
<meta http-equiv="refresh" content="0; url=player/"><link rel="canonical" href="player/">
<p><a href="player/">Open the contribution song player</a></p>
HTML
touch _site/.nojekyll
echo "site ready in _site/"
