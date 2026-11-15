import json
import threading
import time
from pathlib import Path

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

from config import read_env
from patterns import CHORDS, PATTERNS, RANDOM, bar, bar_chord, next_pattern, parse_song, to_steps, to_chunks, chunk_ms

ENV = read_env(Path(__file__).resolve().parent.parent / ".env")  # servo-strummer/.env, not in git
KNOB_BPM_STEP = 5  # each knob click = 5 BPM; the sketch keeps the knob within 0..40 (0..200 BPM)

ui = WebUI()
lock = threading.Lock()  # one conversation with the board at a time
stop = threading.Event()
# playing = pattern name; bar = the bar the robot is playing now, so the page can mirror it;
# song = a loaded chord progression (one chord per bar), used while no chord is chosen
state = {"playing": None, "chord": None, "bpm": 90, "knob_bpm": None, "bar": None, "song": None,
         "servos": True}  # servos False = debug mode: everything runs, but the servos never move
shown_chord = "?"  # chord on the board's LED matrix; "?" = nothing sent yet

# Pick end angles per string, [side A, side B], set from the page and kept across restarts.
ANGLES_FILE = Path(__file__).with_name("angles.json")
try:
    state["angles"] = json.loads(ANGLES_FILE.read_text())
except (OSError, ValueError):
    state["angles"] = [[60, 120] for _ in range(6)]  # same as the sketch's defaults
angles_sent = False  # the sketch starts with its defaults; send ours once it's up


def _knob_bpm():
    """Tempo from the knob, or None when no knob is plugged in. Caller must hold `lock`."""
    pos = Bridge.call("knob", timeout=2)
    return pos * KNOB_BPM_STEP if pos >= 0 else None


def _servo_play(steps, timeout=10):
    """Send steps to the servos, or in debug mode just take as long as they would."""
    if state["servos"]:
        Bridge.call("play", steps, timeout=timeout)
    else:
        time.sleep(chunk_ms(steps) / 1000)


def _send_angles():
    """Give the board the saved angles, once per app start. Caller must hold `lock`."""
    # shortcut: a lone MCU reset (brownout) brings back the defaults until the app restarts;
    # resend whenever stats() shows a fresh uptime if that ever matters.
    global angles_sent
    if not angles_sent and state["servos"]:  # in debug mode they wait until the servos are back
        for i, (a, b) in enumerate(state["angles"]):
            Bridge.call("angles", i, a, b, timeout=3)
        angles_sent = True


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
        _send_angles()
        song = state["song"]
        while not stop.is_set():
            # Pattern, tempo and chord are re-read every bar, so switching patterns, the knob
            # and the camera all take effect at the next bar line.
            gesture = Bridge.call("knob_click", timeout=2)  # 1 = press: next, -1 = double tap: back
            if gesture and not first:  # on the first bar it's a stale press from before Play
                state["playing"] = next_pattern(state["playing"], gesture)
                print(f"knob {gesture:+d}: {state['playing']!r}", flush=True)
            first = False
            name = state["playing"]
            if state["song"] is not song:  # a newly loaded song starts from its first chord
                song, bar_no = state["song"], 0
            chord = bar_chord(name, state["chord"], bar_no, song)
            bar_no += 1
            _show_chord(chord)
            knob = _knob_bpm()
            state["knob_bpm"] = knob
            bpm = knob if knob is not None else state["bpm"]
            if bpm == 0:
                print("knob at 0: stopping", flush=True)
                break
            steps = to_steps(bar(name), bpm, chord)
            # next: the chord of the bar after this one, so the page can call it out in time
            state["bar"] = {"start": time.time(), "steps": steps, "chord": chord,
                            "next": bar_chord(name, state["chord"], bar_no, song)}
            for chunk in to_chunks(steps):
                if stop.is_set():
                    break
                # The sketch plays the whole chunk before replying; nothing else is sent meanwhile,
                # since a message arriving mid-pulse could be garbled on the MCU.
                _servo_play(chunk, timeout=chunk_ms(chunk) / 1000 + 5)
        print("play end", flush=True)
    except Exception as e:
        print(f"play error: {e!r}", flush=True)
    finally:
        try:
            # Keep exact pulses 300 ms so the last-plucked strings finish their swing,
            # then the board sends nothing until the next pattern.
            _servo_play("0:300")
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


def pluck(string: int):
    """String test: pluck one string (0 = low E .. 5 = high e), or -1 for all six in turn."""
    if not -1 <= string <= 5:
        return {"ok": False, "error": "string must be 0-5, or -1 for all"}
    if not lock.acquire(timeout=0.5):
        return {"ok": False, "error": "stop the pattern first"}
    try:
        _send_angles()
        strings = range(6) if string == -1 else [string]
        _servo_play(",".join(f"{1 << s}:300" for s in strings))
    finally:
        lock.release()
    return {"ok": True}


def set_angles(string: int, a: int, b: int):
    """Calibration: where string's pick rests on each side (degrees, a < b)."""
    if not 0 <= string <= 5 or not 10 <= a <= b - 10 or b > 170:
        return {"ok": False, "error": "need string 0-5 and 10 <= a, a + 10 <= b <= 170"}
    if not lock.acquire(timeout=0.5):
        return {"ok": False, "error": "stop the pattern first"}
    try:
        global angles_sent
        _send_angles()
        if not state["servos"]:
            angles_sent = False  # debug mode: the board gets them when the servos are back on
        elif not Bridge.call("angles", string, a, b, timeout=3):
            return {"ok": False, "error": "board refused the angles"}
        state["angles"][string] = [a, b]
    finally:
        lock.release()
    try:
        ANGLES_FILE.write_text(json.dumps(state["angles"]))
    except OSError as e:
        return {"ok": True, "saved": False, "error": f"not saved: {e}"}
    return {"ok": True, "saved": True}


def reset():
    """Every pick back to its start side."""
    if not lock.acquire(timeout=0.5):
        return {"ok": False, "error": "stop the pattern first"}
    try:
        _send_angles()
        if state["servos"]:
            Bridge.call("reset", timeout=5)
    finally:
        lock.release()
    return {"ok": True}


def set_servos(on: bool):
    """Debug mode switch: on=false keeps the servos still while everything else runs."""
    state["servos"] = on
    print(f"servos {'on' if on else 'off (debug mode)'}", flush=True)
    return {"ok": True, "servos": on}


def stop_playing():
    stop.set()  # takes effect after the chunk currently on the board finishes
    return {"ok": True}


def set_chord(name: str = ""):
    # Empty name = no chord: every string plays.
    if name and name not in CHORDS:
        return {"ok": False, "error": "unknown chord"}
    state["chord"] = name or None
    return {"ok": True}


def set_song(chords: str = ""):
    # "Am,G,C,C": one chord per bar, looping. Empty = no song. It plays while no chord is
    # chosen; a chord from the page, camera or microphone still wins, bar by bar.
    names, error = parse_song(chords)
    if error:
        return {"ok": False, "error": error}
    state["song"] = names or None
    return {"ok": True, "song": state["song"]}


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
            _send_angles()
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
    chosen, song = chord or None, state["song"]
    chord = bar_chord(pattern, chosen, bar_no, song)
    return {"ok": True, "chord": chord, "next": bar_chord(pattern, chosen, bar_no + 1, song),
            "steps": to_steps(bar(pattern), min(max(bpm, 30), 200), chord)}


def config():
    # Settings the page needs from .env. The page is only reachable over the USB port forward.
    return {"elevenlabs_key": ENV.get("ELEVENLABS_API_KEY", "")}


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

App.run()
