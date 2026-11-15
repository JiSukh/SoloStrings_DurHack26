"""Everything that talks to the MCU. Every Bridge.call lives here, behind one lock.

The sketch plays a chunk of steps before it replies, and a message that arrives mid-pulse
could be garbled, so only one conversation with the board happens at a time: whoever holds
`lock` (the play loop for as long as it runs, or a single request) is the only caller.
"""

import threading
import time

from .music import chunk_ms

KNOB_BPM_STEP = 5  # each knob click = 5 BPM; the sketch keeps the knob within 0..40 (0..200 BPM)
DEFAULT_ANGLES = [[60, 120] for _ in range(6)]  # same as the sketch's defaults


class Board:
    def __init__(self, bridge, angles=None):
        self.bridge = bridge
        self.lock = threading.Lock()  # one conversation with the board at a time
        self.servos = True  # False = debug mode: everything runs, but the servos never move
        # Pick end angles per string, [side A, side B], set from the page and kept across restarts.
        self.angles = [list(a) for a in (angles or DEFAULT_ANGLES)]
        self.angles_sent = False  # the sketch starts with its defaults; send ours once it's up
        self.shown_chord = "?"  # chord on the board's LED matrix; "?" = nothing sent yet

    # --- calls made with `lock` already held ---

    def knob_bpm(self):
        """Tempo from the knob, or None when no knob is plugged in. Caller must hold `lock`."""
        pos = self.bridge.call("knob", timeout=2)
        return pos * KNOB_BPM_STEP if pos >= 0 else None

    def knob_click(self):
        """1 = press: next, -1 = double tap: back, 0 = nothing. Caller must hold `lock`."""
        return self.bridge.call("knob_click", timeout=2)

    def servo_play(self, steps, timeout=10):
        """Send steps to the servos, or in debug mode just take as long as they would."""
        if self.servos:
            self.bridge.call("play", steps, timeout=timeout)
        else:
            time.sleep(chunk_ms(steps) / 1000)

    def send_angles(self):
        """Give the board the saved angles, once per app start. Caller must hold `lock`."""
        # shortcut: a lone MCU reset (brownout) brings back the defaults until the app restarts;
        # resend whenever stats() shows a fresh uptime if that ever matters.
        if not self.angles_sent and self.servos:  # in debug mode they wait until the servos are back
            for i, (a, b) in enumerate(self.angles):
                self.bridge.call("angles", i, a, b, timeout=3)
            self.angles_sent = True

    def show_chord(self, chord):
        """Put `chord` on the LED matrix if it changed. Caller must hold `lock`."""
        if chord != self.shown_chord:
            self.bridge.call("show", chord or "", timeout=2)
            self.shown_chord = chord

    # --- requests that take the lock themselves ---

    def pluck(self, string):
        """String test: pluck one string (0 = low E .. 5 = high e), or -1 for all six in turn."""
        if not -1 <= string <= 5:
            return {"ok": False, "error": "string must be 0-5, or -1 for all"}
        if not self.lock.acquire(timeout=0.5):
            return {"ok": False, "error": "stop the pattern first"}
        try:
            self.send_angles()
            strings = range(6) if string == -1 else [string]
            self.servo_play(",".join(f"{1 << s}:300" for s in strings))
        finally:
            self.lock.release()
        return {"ok": True}

    def set_angles(self, string, a, b):
        """Calibration: where string's pick rests on each side (degrees, a < b).
        Saving them is the caller's job, once this returns ok."""
        if not 0 <= string <= 5 or not 10 <= a <= b - 10 or b > 170:
            return {"ok": False, "error": "need string 0-5 and 10 <= a, a + 10 <= b <= 170"}
        if not self.lock.acquire(timeout=0.5):
            return {"ok": False, "error": "stop the pattern first"}
        try:
            self.send_angles()
            if not self.servos:
                self.angles_sent = False  # debug mode: the board gets them when the servos are back on
            elif not self.bridge.call("angles", string, a, b, timeout=3):
                return {"ok": False, "error": "board refused the angles"}
            self.angles[string] = [a, b]
        finally:
            self.lock.release()
        return {"ok": True}

    def reset(self):
        """Every pick back to its start side."""
        if not self.lock.acquire(timeout=0.5):
            return {"ok": False, "error": "stop the pattern first"}
        try:
            self.send_angles()
            if self.servos:
                self.bridge.call("reset", timeout=5)
        finally:
            self.lock.release()
        return {"ok": True}

    def set_servos(self, on):
        """Debug mode switch: on=false keeps the servos still while everything else runs."""
        self.servos = on
        print(f"servos {'on' if on else 'off (debug mode)'}", flush=True)
        return {"ok": True, "servos": on}

    def idle_poll(self, chord):
        """While nothing plays: read the knob, show `chord`, send the angles if still due.
        Returns (True, knob_bpm), or (False, None) when the board is busy (never blocks)."""
        if not self.lock.acquire(blocking=False):
            return False, None
        read, knob = False, None
        try:
            knob = self.knob_bpm()
            read = True
            self.show_chord(chord)
            self.send_angles()
        except Exception:
            pass
        finally:
            self.lock.release()
        return (True, knob) if read else (False, None)

    def stats(self):
        # Only ask the board while nothing is playing: a message mid-pattern could be garbled.
        if not self.lock.acquire(blocking=False):
            return {"board": "busy"}
        try:
            return {"board": self.bridge.call("stats", timeout=3)}
        finally:
            self.lock.release()
