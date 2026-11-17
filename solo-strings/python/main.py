"""Solo Strings, minimal player: strums one pattern over a chord loop as soon as the app starts.

There is no web page here: change the three settings below and restart the app. With a Modulino
Knob on the Qwiic connector, the knob sets the tempo (turn it to 0 to stop, back up to start
again) and a double tap on its button moves to the next pattern.

The robot has no fretting hand: you hold the chord, it strums. The chord name tells it which
strings to skip (an open D skips the two low strings) and is shown on the board's LED matrix.
"""

import time

from arduino.app_utils import App, Bridge

from strummer.board import Board
from strummer.music import PATTERNS, RANDOM
from strummer.player import Player

PATTERN = "Folk (D DU UDU)"  # any name in strummer/music.py's PATTERNS, or "Random"
SONG = "Am, G, C, C"         # one chord per bar, looping; "" = strum every string
BPM = 90                     # 30 to 200; ignored while a knob is plugged in

if PATTERN not in PATTERNS and PATTERN != RANDOM:
    raise SystemExit(f"PATTERN {PATTERN!r} is not in strummer/music.py; choose from: {', '.join(PATTERNS)}")

board = Board(Bridge)
player = Player(board, on_bar=lambda bar: print(f"bar {bar['no']}: {bar['chord'] or 'all strings'}", flush=True))
player.set_tempo(BPM)
song = player.set_song(SONG)
if not song["ok"]:
    raise SystemExit(f"SONG {SONG!r}: {song['error']}")

started = False


def loop():
    """Called over and over by the App framework. Starts the pattern once; after that it only
    starts it again when a knob that was turned to 0 is turned back up."""
    global started
    time.sleep(0.5)
    if player.state["playing"]:
        return
    ok, knob = board.idle_poll(player.state["chord"])  # the knob's tempo; None = no knob plugged in
    if not ok:
        return  # the board is busy or not answering yet: try again next time round
    if knob == 0:
        return  # knob at 0 means stop
    if knob is None and started:
        return  # no knob: playing only ends on an error (see the app's log), so don't retry forever
    started = player.play(PATTERN)["ok"]


App.run(user_loop=loop)
