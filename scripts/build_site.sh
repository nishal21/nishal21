#!/usr/bin/env bash
# Assemble the GitHub Pages site: the player plus the song files it loads (same origin, so the
# MP3 is served as audio/mpeg and the download attribute works).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/player
cp player/index.html player/player.css player/player.js _site/player/
for f in contribution-song.mp3 contribution-song.json contribution-song.lrc contribution-song-lyrics.md; do
  cp "assets/$f" _site/player/
done
cat > _site/index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>Contribution song</title>
<meta http-equiv="refresh" content="0; url=player/"><link rel="canonical" href="player/">
<p><a href="player/">Open the contribution song player</a></p>
HTML
touch _site/.nojekyll
echo "site ready in _site/"
