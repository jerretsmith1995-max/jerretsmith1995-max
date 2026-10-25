#!/bin/bash
# Starts Sonny's Arcade fullscreen. Double-click this file in Finder, or run it in Terminal.
# Quit the arcade with Cmd+Q.
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://${DIR// /%20}/arcade/index.html"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ -x "$CHROME" ]; then
  # Kiosk mode = true fullscreen, and Esc goes back to the arcade menu instead of leaving fullscreen.
  # A separate profile folder means it opens fullscreen even if Chrome is already running.
  "$CHROME" --kiosk \
    --user-data-dir="$HOME/.sonnys-arcade-chrome" \
    --no-first-run --no-default-browser-check \
    --autoplay-policy=no-user-gesture-required \
    --disable-features=Translate \
    "$URL" >/dev/null 2>&1 &
else
  echo "Google Chrome isn't installed, so opening in Safari instead."
  echo "In Safari, press Ctrl+Cmd+F for fullscreen. Install Chrome for the best experience."
  open -a Safari "$URL"
fi
