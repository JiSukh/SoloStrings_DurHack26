"""The bar loop: what the robot plays, bar by bar.

It never pushes anything itself: it reports through `on_bar(bar)` at each bar start and
`on_state(state)` whenever the playing state changes, and the web layer forwards those.
"""

import threading
import time

from .music import CHORDS, PATTERNS, RANDOM, bar, bar_chord, next_pattern, parse_song, to_chunks, to_steps
from .music import chunk_ms


def _ignore(_):
    pass


class Player:
    def __init__(self, board, on_bar=_ignore, on_state=_ignore):
        self.board = board
        self.on_bar = on_bar
        self.on_state = on_state
        self.stop = threading.Event()
        # playing = pattern name; bar = the bar the robot is playing now, so the page can mirror it;
        # song = a loaded chord progression (one chord per bar), used while no chord is chosen
        self.state = {"playing": None, "chord": None, "bpm": 90, "knob_bpm": None, "bar": None, "song": None}

    def changed(self):
        self.on_state(self.state)

    def set_knob_bpm(self, knob):
        """Record the knob's tempo; tells on_state only when it moved."""
        if knob != self.state["knob_bpm"]:
            self.state["knob_bpm"] = knob
            self.changed()

    # --- the loop ---

    def _play(self):
        board, state = self.board, self.state
        try:
            print(f"play start: {state['playing']!r}", flush=True)
            first = True
            bar_no = 0
            board.send_angles()
            song = state["song"]
            while not self.stop.is_set():
                # Pattern, tempo and chord are re-read every bar, so switching patterns, the knob
                # and the camera all take effect at the next bar line.
                gesture = board.knob_click()  # 1 = press: next, -1 = double tap: back
                if gesture and not first:  # on the first bar it's a stale press from before Play
                    state["playing"] = next_pattern(state["playing"], gesture)
                    print(f"knob {gesture:+d}: {state['playing']!r}", flush=True)
                    self.changed()
                first = False
                name = state["playing"]
                if state["song"] is not song:  # a newly loaded song starts from its first chord
                    song, bar_no = state["song"], 0
                chord = bar_chord(name, state["chord"], bar_no, song)
                bar_no += 1
                board.show_chord(chord)
                knob = board.knob_bpm()
                self.set_knob_bpm(knob)
                bpm = knob if knob is not None else state["bpm"]
                if bpm == 0:
                    print("knob at 0: stopping", flush=True)
                    break
                steps = to_steps(bar(name), bpm, chord)
                # next: the chord of the bar after this one, so the page can call it out in time
                state["bar"] = {"start": time.time(), "steps": steps, "chord": chord,
                                "next": bar_chord(name, state["chord"], bar_no, song)}
                self.on_bar(state["bar"])
                for chunk in to_chunks(steps):
                    if self.stop.is_set():
                        break
                    # The sketch plays the whole chunk before replying; nothing else is sent meanwhile,
                    # since a message arriving mid-pulse could be garbled on the MCU.
                    board.servo_play(chunk, timeout=chunk_ms(chunk) / 1000 + 5)
            print("play end", flush=True)
        except Exception as e:
            print(f"play error: {e!r}", flush=True)
        finally:
            try:
                # Keep exact pulses 300 ms so the last-plucked strings finish their swing,
                # then the board sends nothing until the next pattern.
                board.servo_play("0:300")
            except Exception as e:
                print(f"tail error: {e!r}", flush=True)
            state["playing"] = None
            state["bar"] = None
            board.lock.release()
            self.changed()

    # --- requests ---

    def play(self, pattern):
        if pattern not in PATTERNS and pattern != RANDOM:
            return {"ok": False, "error": "unknown pattern"}
        if self.state["playing"] and not self.stop.is_set():
            self.state["playing"] = pattern  # already playing: switch at the next bar
            self.changed()
            return {"ok": True, "switched": True}
        if not self.board.lock.acquire(timeout=0.5):  # a status poll may hold it for a moment
            return {"ok": False, "error": "busy"}
        self.stop.clear()
        self.state["playing"] = pattern
        self.changed()
        threading.Thread(target=self._play, daemon=True).start()
        return {"ok": True}

    def stop_playing(self):
        self.stop.set()  # takes effect after the chunk currently on the board finishes
        return {"ok": True}

    def set_chord(self, name=""):
        # Empty name = no chord: every string plays.
        if name and name not in CHORDS:
            return {"ok": False, "error": "unknown chord"}
        self.state["chord"] = name or None
        self.changed()
        return {"ok": True}

    def set_song(self, chords=""):
        # "Am,G,C,C": one chord per bar, looping. Empty = no song. It plays while no chord is
        # chosen; a chord from the page, camera or microphone still wins, bar by bar.
        names, error = parse_song(chords)
        if error:
            return {"ok": False, "error": error}
        self.state["song"] = names or None
        self.changed()
        return {"ok": True, "song": self.state["song"]}

    def set_tempo(self, bpm):
        # Used when no knob is plugged in.
        self.state["bpm"] = min(max(bpm, 30), 200)
        self.changed()
        return {"ok": True}

    def steps(self, pattern, bpm=90, chord="", bar_no=0):
        """One bar of steps for the page's virtual guitar, made exactly as the robot's are."""
        if pattern not in PATTERNS and pattern != RANDOM:
            return {"ok": False, "error": "unknown pattern"}
        if chord and chord not in CHORDS:
            return {"ok": False, "error": "unknown chord"}
        chosen, song = chord or None, self.state["song"]
        chord = bar_chord(pattern, chosen, bar_no, song)
        return {"ok": True, "chord": chord, "next": bar_chord(pattern, chosen, bar_no + 1, song),
                "steps": to_steps(bar(pattern), min(max(bpm, 30), 200), chord)}
