"""Check the live push: a state change reaches a socket.io client within 1 s.

Run from a PC with the page forwarded (./open.sh, or adb forward tcp:7000 tcp:7000):
    pip install "python-socketio[client]" requests
    python servo-strummer/python/tools/socket_check.py [http://localhost:7000]
It turns debug mode on (servos stay still), changes the chord, plays a few bars, stops,
and turns the servos back on.
Not part of the app or of scripts/test.sh (needs pip packages and a running board).
"""

import sys
import threading
import time

import requests
import socketio

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7000"
got = {"state": [], "bar": []}
seen = threading.Event()

sio = socketio.Client()


@sio.on("state")
def on_state(msg):
    got["state"].append((time.time(), msg))
    seen.set()


@sio.on("bar")
def on_bar(msg):
    got["bar"].append((time.time(), msg))


sio.connect(URL)
requests.post(f"{URL}/servos", params={"on": "false"}, timeout=5)  # debug mode: nothing moves
try:
    time.sleep(0.5)
    seen.clear()
    t = time.time()
    requests.post(f"{URL}/chord", params={"name": "G"}, timeout=5)
    ok = seen.wait(1.0)
    delay = got["state"][-1][0] - t if ok else None
    print(f"state after /chord: {'%.0f ms' % (delay * 1000) if ok else 'NOT within 1 s'}")

    requests.post(f"{URL}/play", params={"pattern": "Strum"}, timeout=5)
    time.sleep(3)
    requests.post(f"{URL}/stop", timeout=5)
    time.sleep(3)
    requests.post(f"{URL}/chord", params={"name": ""}, timeout=5)
    print(f"bar events while playing: {len(got['bar'])}")
finally:
    # leave the robot as we found it: servos back on, even if a step above failed
    requests.post(f"{URL}/servos", params={"on": "true"}, timeout=5)
    print("servos back on")
    sio.disconnect()
sys.exit(0 if ok and got["bar"] else 1)
