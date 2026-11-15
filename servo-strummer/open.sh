#!/usr/bin/env bash
# Open the Servo Strummer page from this PC over USB: waits for the UNO Q, starts the app
# if it isn't running, forwards port 7000 and opens the browser.
set -euo pipefail

ADB=$(ls ~/.arduino15/packages/arduino/tools/adb/*/adb 2>/dev/null | head -1)
[ -x "$ADB" ] || { echo "adb not found: install the UNO Q board package in the Arduino IDE first"; exit 1; }
URL=http://localhost:7000

echo "Waiting for the UNO Q on USB..."
"$ADB" wait-for-device
echo "Waiting for it to finish booting..."
until "$ADB" shell systemctl is-active --quiet arduino-router 2>/dev/null; do sleep 2; done

if ! "$ADB" shell arduino-app-cli app ps 2>/dev/null | grep -q servo-strummer; then
  echo "Starting the app (takes ~30 s)..."
  "$ADB" shell arduino-app-cli app start user:servo-strummer | tail -1
fi

"$ADB" forward tcp:7000 tcp:7000 >/dev/null
echo "Waiting for the page..."
for _ in $(seq 60); do curl -sf -m 2 "$URL/status" >/dev/null && break; sleep 2; done
curl -sf -m 2 "$URL/status" >/dev/null || { echo "Page didn't come up; check: $ADB shell arduino-app-cli app logs user:servo-strummer"; exit 1; }

echo "Opening $URL"
xdg-open "$URL" >/dev/null 2>&1 &
