"""Wiring only: REST routes, live socket push, and the idle knob watcher."""

import os
import threading
import time
from pathlib import Path

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

from strummer.board import Board
from strummer.config import read_env
from strummer.music import CHORDS, PATTERNS, RANDOM
from strummer.player import Player
from strummer.store import Store

APP_DIR = Path(__file__).resolve().parent.parent  # servo-strummer/
ENV = read_env(APP_DIR / ".env")  # servo-strummer/.env, not in git
KNOB_WATCH_S = 0.3  # how often an idle board's knob is read, so the page sees it move

store = Store(os.environ.get("STRUMMER_DB") or APP_DIR / "data" / "strummer.db")
store.migrate_angles_json(Path(__file__).with_name("angles.json"))  # from before the sqlite store

ui = WebUI()
board = Board(Bridge, store.get("angles"))


def snapshot():
    # now: lets the page line its clock up with ours
    return {**player.state, "servos": board.servos, "angles": board.angles, "now": time.time()}


def push(kind, message):
    """Socket push to every page. Thread-safe (the brick hands it to its event loop); a failed
    push must never stop the play loop."""
    try:
        ui.send_message(kind, message)
    except Exception as e:
        print(f"push {kind} error: {e!r}", flush=True)


player = Player(board,
                on_bar=lambda bar: push("bar", {**bar, "now": time.time()}),
                on_state=lambda _state: push("state", snapshot()))


def knob_watcher():
    """While nothing plays, read the knob every 300 ms and push when it moves. The play loop
    reads it itself while playing; idle_poll never waits for the lock."""
    while True:
        time.sleep(KNOB_WATCH_S)
        if player.state["playing"]:
            continue
        ok, knob = board.idle_poll(player.state["chord"])
        if ok:
            player.set_knob_bpm(knob)


# --- routes (same paths and parameters as before the split) ---

def patterns():
    return {"patterns": list(PATTERNS) + [RANDOM]}


def chords():
    return {"chords": CHORDS}


def set_angles(string: int, a: int, b: int):
    """Calibration: where string's pick rests on each side (degrees, a < b)."""
    r = board.set_angles(string, a, b)
    if not r["ok"]:
        return r
    player.changed()
    try:
        store.set("angles", board.angles)
    except Exception as e:
        return {"ok": True, "saved": False, "error": f"not saved: {e}"}
    return {"ok": True, "saved": True}


def set_servos(on: bool):
    r = board.set_servos(on)
    player.settings_changed()  # servos off mid-play: the player stops the board's sequencer
    return r


def status():
    # While idle, read the knob so the page shows it; while playing, the bar loop keeps it fresh
    # (and owns the LED matrix's chord).
    if not player.state["playing"]:
        ok, knob = board.idle_poll(player.state["chord"])
        if ok:
            player.set_knob_bpm(knob)
    return snapshot()


def config():
    # Settings the page needs from .env. The page is only reachable over the USB port forward.
    return {"elevenlabs_key": ENV.get("ELEVENLABS_API_KEY", "")}


def play(pattern: str):
    return player.play(pattern)


def stop_playing():
    return player.stop_playing()


def pluck(string: int):
    if player.state["playing"]:  # the board plays bars by itself now, so the lock is free
        return {"ok": False, "error": "stop the pattern first"}
    return board.pluck(string)


def reset():
    if player.state["playing"]:
        return {"ok": False, "error": "stop the pattern first"}
    return board.reset()


def set_chord(name: str = ""):
    return player.set_chord(name)


def set_song(chords: str = ""):
    return player.set_song(chords)


def set_tempo(bpm: int):
    return player.set_tempo(bpm)


def steps(pattern: str, bpm: int = 90, chord: str = "", bar_no: int = 0):
    return player.steps(pattern, bpm, chord, bar_no)


def debug():
    return board.stats()


ui.expose_api("GET", "/patterns", patterns)
ui.expose_api("GET", "/chords", chords)
ui.expose_api("POST", "/play", play)
ui.expose_api("POST", "/stop", stop_playing)
ui.expose_api("POST", "/pluck", pluck)
ui.expose_api("POST", "/reset", reset)
ui.expose_api("POST", "/servos", set_servos)
ui.expose_api("POST", "/angles", set_angles)
ui.expose_api("POST", "/chord", set_chord)
ui.expose_api("POST", "/tempo", set_tempo)
ui.expose_api("POST", "/song", set_song)
ui.expose_api("GET", "/status", status)
ui.expose_api("GET", "/debug", debug)
ui.expose_api("GET", "/config", config)
ui.expose_api("GET", "/steps", steps)

threading.Thread(target=knob_watcher, daemon=True).start()

App.run()
