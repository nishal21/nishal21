#!/bin/sh
# Bundles the vendored youtube-ambilight sources (src/) into ambilight.js, the one file the page loads, and stamps
# its hash into ../../index.html so browsers fetch the new copy. Needs esbuild (npx esbuild works).
set -e
cd "$(dirname "$0")"
${ESBUILD:-npx esbuild} src/ambilight.js --bundle --format=iife --global-name=YTAmbilight --legal-comments=inline \
  --target=es2022 --outfile=ambilight.js
v=$(sha256sum ambilight.js | cut -c1-10)
sed -i "s|vendor/ambilight/ambilight.js?v=[0-9a-z]*|vendor/ambilight/ambilight.js?v=$v|" ../../index.html
echo "ambilight.js $v"
