import threading
import time

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

from patterns import CHORDS, PATTERNS, RANDOM, bar, bar_chord, next_pattern, to_steps, to_chunks, chunk_ms

KNOB_BPM_STEP = 5  # each knob click = 5 BPM; the sketch keeps the knob within 0..40 (0..200 BPM)

ui = WebUI()
lock = threading.Lock()  # one conversation with the board at a time
stop = threading.Event()
# playing = pattern name; bar = the bar the robot is playing now, so the page can mirror it
state = {"playing": None, "chord": None, "bpm": 90, "knob_bpm": None, "bar": None}
shown_chord = "?"  # chord on the board's LED matrix; "?" = nothing sent yet


def _knob_bpm():
    """Tempo from the knob, or None when no knob is plugged in. Caller must hold `lock`."""
    pos = Bridge.call("knob", timeout=2)
    return pos * KNOB_BPM_STEP if pos >= 0 else None


def _show_chord(chord):
    """Put `chord` on the LED matrix if it changed. Caller must hold `lock`."""
    global shown_chord
    if chord != shown_chord:
        Bridge.call("show", chord or "", timeout=2)
        shown_chord = chord


def _play():
    try:
        print(f"play start: {state['playing']!r}", flush=True)
        first = True
        bar_no = 0
        while not stop.is_set():
            # Pattern, tempo and chord are re-read every bar, so switching patterns, the knob
            # and the camera all take effect at the next bar line.
            gesture = Bridge.call("knob_click", timeout=2)  # 1 = press: next, -1 = double tap: back
            if gesture and not first:  # on the first bar it's a stale press from before Play
                state["playing"] = next_pattern(state["playing"], gesture)
                print(f"knob {gesture:+d}: {state['playing']!r}", flush=True)
            first = False
            name = state["playing"]
            chord = bar_chord(name, state["chord"], bar_no)
            bar_no += 1
            _show_chord(chord)
            knob = _knob_bpm()
            state["knob_bpm"] = knob
            bpm = knob if knob is not None else state["bpm"]
            if bpm == 0:
                print("knob at 0: stopping", flush=True)
                break
            steps = to_steps(bar(name), bpm, chord)
            state["bar"] = {"start": time.time(), "steps": steps, "chord": chord}
            for chunk in to_chunks(steps):
                if stop.is_set():
                    break
                # The sketch plays the whole chunk before replying; nothing else is sent meanwhile,
                # since a message arriving mid-pulse could be garbled on the MCU.
                Bridge.call("play", chunk, timeout=chunk_ms(chunk) / 1000 + 5)
        print("play end", flush=True)
    except Exception as e:
        print(f"play error: {e!r}", flush=True)
    finally:
        try:
            # Keep exact pulses 300 ms so the last-plucked strings finish their swing,
            # then the board sends nothing until the next pattern.
            Bridge.call("play", "0:300")
        except Exception as e:
            print(f"tail error: {e!r}", flush=True)
        state["playing"] = None
        state["bar"] = None
        lock.release()


def patterns():
    return {"patterns": list(PATTERNS) + [RANDOM]}


def chords():
    return {"chords": CHORDS}


def play(pattern: str):
    if pattern not in PATTERNS and pattern != RANDOM:
        return {"ok": False, "error": "unknown pattern"}
    if state["playing"] and not stop.is_set():
        state["playing"] = pattern  # already playing: switch at the next bar
        return {"ok": True, "switched": True}
    if not lock.acquire(timeout=0.5):  # a status poll may hold it for a moment
        return {"ok": False, "error": "busy"}
    stop.clear()
    state["playing"] = pattern
    threading.Thread(target=_play, daemon=True).start()
    return {"ok": True}


def stop_playing():
    stop.set()  # takes effect after the chunk currently on the board finishes
    return {"ok": True}


def set_chord(name: str = ""):
    # Empty name = no chord: every string plays.
    if name and name not in CHORDS:
        return {"ok": False, "error": "unknown chord"}
    state["chord"] = name or None
    return {"ok": True}


def set_tempo(bpm: int):
    # Used when no knob is plugged in.
    state["bpm"] = min(max(bpm, 30), 200)
    return {"ok": True}


def status():
    # While idle, read the knob so the page shows it; while playing, _play keeps it fresh.
    if lock.acquire(blocking=False):
        try:
            state["knob_bpm"] = _knob_bpm()
            _show_chord(state["chord"])
        except Exception:
            pass
        finally:
            lock.release()
    return {**state, "now": time.time()}  # now: lets the page line its clock up with ours


def steps(pattern: str, bpm: int = 90, chord: str = "", bar_no: int = 0):
    """One bar of steps for the page's virtual guitar, made exactly as the robot's are."""
    if pattern not in PATTERNS and pattern != RANDOM:
        return {"ok": False, "error": "unknown pattern"}
    if chord and chord not in CHORDS:
        return {"ok": False, "error": "unknown chord"}
    chord = bar_chord(pattern, chord or None, bar_no)
    return {"ok": True, "chord": chord, "steps": to_steps(bar(pattern), min(max(bpm, 30), 200), chord)}


def debug():
    # Only ask the board while nothing is playing: a message mid-pattern could be garbled.
    if not lock.acquire(blocking=False):
        return {"board": "busy"}
    try:
        return {"board": Bridge.call("stats", timeout=3)}
    finally:
        lock.release()


ui.expose_api("GET", "/patterns", patterns)
ui.expose_api("GET", "/chords", chords)
ui.expose_api("POST", "/play", play)
ui.expose_api("POST", "/stop", stop_playing)
ui.expose_api("POST", "/chord", set_chord)
ui.expose_api("POST", "/tempo", set_tempo)
ui.expose_api("GET", "/status", status)
ui.expose_api("GET", "/debug", debug)
ui.expose_api("GET", "/steps", steps)

App.run()
