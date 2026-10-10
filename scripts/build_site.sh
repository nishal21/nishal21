#!/usr/bin/env bash
# Assemble the GitHub Pages site: the song player, the video page, plus the song files it loads (same origin, so the
# MP3 is served as audio/mpeg and the download attribute works).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/player/fonts
cp player/index.html player/player.css player/player.js _site/player/
cp player/fonts/*.woff2 player/fonts/LICENSE.txt _site/player/fonts/
for f in contribution-song.mp3 contribution-song.json contribution-song.lrc contribution-song-lyrics.md; do
  cp "assets/$f" _site/player/
done
# Cover for link previews and the lock screen (needs Pillow, which the song step already installs).
python3 player/make_cover.py _site/player || echo "cover not built; the page draws its own"
# 15 s vertical video of the busiest week, for sharing (optional: the player hides the link without it)
python3 scripts/share_clip.py _site/player || echo "share clip not built"
# The video page: the share clip, the YouTube library (videos.json, refreshed nightly into assets/
# and kept from the last good run if the feed fails) and a player for any link.
mkdir -p _site/video
cp -R video/. _site/video/
python3 scripts/youtube_videos.py site _site/video || echo "video library not built; the page still plays links"
if [ -f _site/player/share-clip.mp4 ]; then
  ffmpeg -loglevel error -y -ss 1 -i _site/player/share-clip.mp4 -frames:v 1 -vf scale=540:-2 -q:v 4 _site/video/clip-poster.jpg \
    || echo "clip poster not built"
fi
cat > _site/index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>Contribution song</title>
<meta http-equiv="refresh" content="0; url=player/"><link rel="canonical" href="player/">
<p><a href="player/">Open the contribution song player</a></p>
HTML
touch _site/.nojekyll
echo "site ready in _site/"
