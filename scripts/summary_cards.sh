#!/usr/bin/env bash
# Caches the three github-profile-summary-cards into assets/.
# The productive-time card takes ~10 s to render, longer than GitHub's image proxy waits,
# so linking it directly shows a broken image. A failed or non-SVG download keeps the last good copy.
set -u
base="https://github-profile-summary-cards.vercel.app/api/cards"
for card in productive-time most-commit-language repos-per-language; do
  extra=""; [ "$card" = productive-time ] && extra="&utcOffset=5.5"
  for mode in light dark; do
    theme=github; [ "$mode" = dark ] && theme=tokyonight
    out="assets/summary-$card-$mode.svg"
    if curl -sfL --retry 3 --max-time 60 "$base/$card?username=nishal21&theme=$theme$extra" -o "$out.tmp" \
       && grep -q '<svg' "$out.tmp"; then mv "$out.tmp" "$out"; else rm -f "$out.tmp"; echo "kept old $out"; fi
  done
done
