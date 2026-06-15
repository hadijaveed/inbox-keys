#!/bin/bash
# Regenerate icon PNGs from the SVG masters.
#
# logo.svg        full design (palette bar over envelope), used for 48 and 128
# logo-small.svg  simplified, thicker geometry tuned for 16 and 32
#
# icon128.png follows Chrome Web Store guidance: 96x96 content centered in a
# 128x128 canvas with 16px transparent padding.
#
# Requires Google Chrome and ImageMagick (brew install imagemagick).
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"

"$CHROME" --headless=new --disable-gpu --no-first-run \
  --screenshot="$TMP/logo512.png" --window-size=512,512 \
  --default-background-color=00000000 "file://$PWD/logo.svg"
"$CHROME" --headless=new --disable-gpu --no-first-run \
  --screenshot="$TMP/logosmall512.png" --window-size=512,512 \
  --default-background-color=00000000 "file://$PWD/logo-small.svg"

magick "$TMP/logosmall512.png" -filter Lanczos -resize 16x16 icon16.png
magick "$TMP/logosmall512.png" -filter Lanczos -resize 32x32 icon32.png
magick "$TMP/logo512.png" -filter Lanczos -resize 48x48 icon48.png
magick "$TMP/logo512.png" -filter Lanczos -resize 96x96 \
  -gravity center -background none -extent 128x128 icon128.png

rm -rf "$TMP"
echo "wrote icon16.png icon32.png icon48.png icon128.png"
