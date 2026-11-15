#!/usr/bin/env bash
# Build the page and put the app on the UNO Q over USB:
#   1. build web/ into servo-strummer/assets
#   2. refuse if the robot is playing (a restart mid-pattern would leave picks mid-swing)
#   3. adb push servo-strummer to /home/arduino/ArduinoApps/, never servo-strummer/data/ (the board's saved settings)
#   4. arduino-app-cli app stop/start user:servo-strummer
#   5. adb forward tcp:7000 tcp:7000
#   6. wait for /status
# adb comes from the Arduino IDE's UNO Q board package (or set ADB=/path/to/adb).
set -euo pipefail
cd "$(dirname "$0")/.."

APP=servo-strummer
REMOTE=/home/arduino/ArduinoApps
URL=http://localhost:7000

if [ -z "${ADB:-}" ]; then
  for a in ~/.arduino15/packages/arduino/tools/adb/*/adb ~/.arduino15/packages/arduino/tools/adb/*/adb.exe \
           "${LOCALAPPDATA:-/nonexistent}"/Arduino15/packages/arduino/tools/adb/*/adb.exe; do
    if [ -x "$a" ]; then ADB=$a; fi
  done
fi
if [ -z "${ADB:-}" ] && command -v adb >/dev/null; then ADB=$(command -v adb); fi
[ -n "${ADB:-}" ] || { echo "adb not found: install the UNO Q board package in the Arduino IDE, or set ADB=" >&2; exit 1; }

echo "1/6 Building the page..."
npm --prefix web run build

echo "2/6 Checking the robot isn't playing..."
"$ADB" wait-for-device
"$ADB" forward tcp:7000 tcp:7000 >/dev/null
if status=$(curl -sf -m 3 "$URL/status"); then
  playing=$(printf '%s' "$status" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("playing") or "")')
  if [ -n "$playing" ]; then
    echo "The robot is playing \"$playing\": press Stop first, then deploy again." >&2
    exit 1
  fi
fi

echo "3/6 Copying the app (without data/)..."
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/$APP"
for item in "$APP"/* "$APP"/.env; do
  [ -e "$item" ] || continue
  case "$(basename "$item")" in data) continue ;; esac
  cp -R "$item" "$stage/$APP/"
done
find "$stage" -name __pycache__ -type d -prune -exec rm -rf {} +
"$ADB" shell rm -rf "$REMOTE/$APP/assets"  # the build replaces it; don't leave old bundles behind
"$ADB" push "$stage/$APP" "$REMOTE/" >/dev/null

echo "4/6 Restarting the app (takes ~30 s)..."
"$ADB" shell arduino-app-cli app stop "user:$APP" >/dev/null 2>&1 || true
"$ADB" shell arduino-app-cli app start "user:$APP" | tail -1

echo "5/6 Forwarding port 7000..."
"$ADB" forward tcp:7000 tcp:7000 >/dev/null

echo "6/6 Waiting for the page..."
for _ in $(seq 60); do
  if curl -sf -m 2 "$URL/status" >/dev/null; then
    echo "Up: $URL"
    exit 0
  fi
  sleep 2
done
echo "The page didn't come up; check: $ADB shell arduino-app-cli app logs user:$APP" >&2
exit 1
