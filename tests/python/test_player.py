"""The bar loop and main.py, against a fake Bridge (no board, no Arduino packages)."""

import importlib
import sys
import threading
import time
import types
import unittest

import _path  # noqa: F401
from strummer import player as player_mod

# Names the sketch provides; Python can't provide a notification handler under any of them.
import re
from pathlib import Path
_SKETCH = Path(__file__).resolve().parents[2] / "solo-strings" / "sketch" / "sketch.ino"
MCU_RPCS = set(re.findall(r'Bridge\.provide\("(\w+)"', _SKETCH.read_text()))
assert "knob" in MCU_RPCS
from strummer.board import Board
from strummer.music import PATTERNS, encode_bar, parse_bar
from strummer.player import Player


class FakeBridge:
    """Records every call; knob at 18 clicks (90 BPM), no knob presses."""

    def __init__(self, knob=18):
        self.calls = []
        self.knob = knob
        self.click = 0  # set to 1 / -1 for one knob gesture; reported once, like the sketch

    def call(self, name, *args, **kw):
        self.calls.append(name)
        if name == "knob_click":
            click, self.click = self.click, 0
            return click
        return self.knob if name == "knob" else True


class FakeMCU(FakeBridge):
    """FakeBridge plus a sequencer that starts a bar every `bar_s` seconds. With notify=True it
    calls the handlers Python provided (as Bridge.notify would); with provide_ok=False Python
    can't register them, and with notify=False they are registered but never called. Either way
    its "seq" state is there for the polling fallback."""

    def __init__(self, notify=True, provide_ok=True, bar_s=0.08, knob=18):
        super().__init__(knob)
        self.notify, self.provide_ok, self.bar_s = notify, provide_ok, bar_s
        self.handlers, self.queued, self.shown = {}, [], []
        self.running, self.bar_no, self.bpm, self.gestures, self.last_gesture = False, -1, 0, 0, 0
        self.halt = threading.Event()

    def provide(self, name, fn):
        if not self.provide_ok:
            raise AttributeError("this Bridge can't provide")
        if name in MCU_RPCS:  # the router refuses a name the sketch already provides
            raise ValueError(f"Method {name!r} is already provided by another client.")
        self.handlers[name] = fn

    def _emit(self, name, *args):
        if self.notify and name in self.handlers:
            self.handlers[name](*args)

    def _run(self):
        while self.running and not self.halt.is_set():
            self.bar_no += 1
            self._emit("bar", self.bar_no, self.bpm)
            self.halt.wait(self.bar_s)

    def gesture(self, g):
        self.gestures += 1
        self.last_gesture = g
        self._emit("knob_gesture", g)

    def knob_stop(self):  # knob turned to 0: the MCU stops at the beat and says so
        self.running = False
        self._emit("stopped", 0)

    def call(self, name, *args, **kw):
        self.calls.append(name)
        if name == "queue":
            parse_bar(args[0])  # must be a well-formed bar
            self.queued.append(args[0])
            return True
        if name == "start":
            self.bpm = self.knob * 5 if self.knob >= 0 else args[0]
            if self.bpm <= 0:
                return False
            self.running, self.bar_no = True, -1
            self.halt.clear()
            threading.Thread(target=self._run, daemon=True).start()
            return True
        if name == "stop":
            self.running = False
            self.halt.set()
            return True
        if name == "seq":
            return f"{int(self.running)} {self.bar_no} {self.bpm} {self.gestures} {self.last_gesture}"
        if name == "show":
            self.shown.append(args[0])
        self.calls.pop()  # FakeBridge.call records it
        return super().call(name, *args, **kw)


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


class PlayerTest(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge()
        self.board = Board(self.bridge)
        self.board.set_servos(False)  # debug mode: steps take their time but never reach "play"
        self.bars, self.states = [], []
        self.player = Player(self.board, on_bar=self.bars.append,
                             on_state=lambda s: self.states.append(dict(s)))

    def tearDown(self):
        self.player.stop_playing()
        wait_for(lambda: self.player.state["playing"] is None)

    def test_reports_bars_and_state_through_callbacks(self):
        self.assertTrue(self.player.play("Strum")["ok"])
        self.assertTrue(wait_for(lambda: self.bars), "no bar reported")
        bar = self.bars[0]
        self.assertEqual(set(bar), {"start", "steps", "chord", "next", "no"})
        self.assertEqual(self.states[0]["playing"], "Strum")
        self.assertEqual(self.player.state["knob_bpm"], 90)
        self.player.stop_playing()
        self.assertTrue(wait_for(lambda: self.player.state["playing"] is None), "didn't stop")
        self.assertIsNone(self.states[-1]["playing"])  # the stop was reported too
        self.assertFalse(self.board.lock.locked())

    def test_switching_and_settings_report_state(self):
        self.player.play("Strum")
        n = len(self.states)
        self.assertTrue(self.player.play("Riptide")["switched"])
        self.assertTrue(self.player.set_chord("Am")["ok"])
        self.assertTrue(self.player.set_tempo(500)["ok"])
        self.assertTrue(self.player.set_song("Am,G")["ok"])
        self.assertEqual(len(self.states), n + 4)
        self.assertEqual(self.player.state["bpm"], 200)
        self.assertFalse(self.player.set_chord("H")["ok"])
        self.assertFalse(self.player.play("nope")["ok"])

    def test_knob_bpm_reports_only_on_change(self):
        self.player.set_knob_bpm(90)
        self.player.set_knob_bpm(90)
        self.player.set_knob_bpm(None)
        self.assertEqual([s["knob_bpm"] for s in self.states], [90, None])

    def test_knob_at_zero_stops(self):
        self.bridge.knob = 0
        self.player.play("Strum")
        self.assertTrue(wait_for(lambda: self.player.state["playing"] is None))
        self.assertEqual(self.bars, [])

    def test_steps_for_the_virtual_guitar(self):
        r = self.player.steps("Riptide", 90, "", 1)
        self.assertTrue(r["ok"] and r["chord"] == "G" and r["next"] == "C" and r["steps"])
        self.assertFalse(self.player.steps("Riptide", 90, "H")["ok"])

    def test_idle_poll_never_blocks(self):
        self.assertEqual(self.board.idle_poll("C"), (True, 90))
        with self.board.lock:
            self.assertEqual(self.board.idle_poll("C"), (False, None))
            self.assertEqual(self.board.stats(), {"board": "busy"})


class SequencerTest(unittest.TestCase):
    """The player against a fake MCU sequencer: notify, polling fallback, re-queueing."""

    def make(self, **kw):
        self.mcu = FakeMCU(**kw)
        self.board = Board(self.mcu)
        self.bars, self.states = [], []
        self.player = Player(self.board, on_bar=self.bars.append, on_state=lambda s: self.states.append(dict(s)))
        return self.player

    def tearDown(self):
        self.player.stop_playing()
        wait_for(lambda: self.player.state["playing"] is None)
        self.mcu.halt.set()

    def test_riptide_changes_chord_on_every_bar(self):
        p = self.make()
        self.assertFalse(p.polling)
        self.assertTrue(p.play("Riptide")["ok"])
        self.assertTrue(wait_for(lambda: len(self.bars) >= 5), "bars didn't arrive")
        self.assertEqual([b["chord"] for b in self.bars[:5]], ["Am", "G", "C", "C", "Am"])
        self.assertEqual([b["next"] for b in self.bars[:4]], ["G", "C", "C", "Am"])
        self.assertEqual(self.mcu.shown[:4], ["Am", "G", "C", "Am"])  # the LED follows the bar (C, C sent once)
        # one bar queued ahead: the first before start, then one per bar notification
        self.assertEqual(self.mcu.queued[0], encode_bar(PATTERNS["Riptide"], "Am"))
        self.assertEqual(self.mcu.queued[1], encode_bar(PATTERNS["Riptide"], "G"))
        self.assertLess(self.mcu.calls.index("queue"), self.mcu.calls.index("start"))
        self.assertEqual(self.player.state["knob_bpm"], 90)

    def test_knob_double_tap_switches_pattern_at_the_bar(self):
        p = self.make(bar_s=0.3)
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        n = len(self.mcu.queued)
        self.mcu.gesture(-1)
        self.assertTrue(wait_for(lambda: len(self.mcu.queued) > n))  # re-queued at once
        self.assertEqual(p.state["playing"], "Down-up eighths")
        self.assertEqual(self.mcu.queued[-1], encode_bar(PATTERNS["Down-up eighths"]))

    def test_knob_press_asks_the_page_to_listen(self):
        p = self.make(bar_s=0.3)
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        self.mcu.gesture(1)
        self.assertTrue(wait_for(lambda: p.state["talk"] == 1), "press not counted")
        self.assertEqual(p.state["playing"], "Strum")  # a press no longer changes the pattern

    def test_bars_carry_their_song_bar_number(self):
        p = self.make()
        p.set_song("G,C")
        p.play("Strum")
        self.assertTrue(wait_for(lambda: len(self.bars) >= 3))
        self.assertEqual([(b["no"], b["chord"]) for b in self.bars[:3]], [(0, "G"), (1, "C"), (2, "G")])

    def test_page_changes_requeue_the_waiting_bar(self):
        p = self.make(bar_s=0.5)
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        p.set_chord("D")
        self.assertTrue(wait_for(lambda: self.mcu.queued[-1] == encode_bar(PATTERNS["Strum"], "D")))
        p.play("Boom-chick")
        self.assertTrue(wait_for(lambda: self.mcu.queued[-1] == encode_bar(PATTERNS["Boom-chick"], "D")))
        p.set_chord("")
        p.set_song("E,A")  # a new song starts from its first chord
        self.assertTrue(wait_for(lambda: self.mcu.queued[-1] == encode_bar(PATTERNS["Boom-chick"], "E")))

    def test_stop(self):
        p = self.make()
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        p.stop_playing()
        self.assertTrue(wait_for(lambda: p.state["playing"] is None))
        self.assertIn("stop", self.mcu.calls)
        self.assertIsNone(self.states[-1]["playing"])
        self.assertTrue(p.play("Strum")["ok"])  # and it starts again

    def test_knob_at_zero(self):
        p = self.make(knob=0)
        p.play("Strum")
        self.assertTrue(wait_for(lambda: p.state["playing"] is None))
        self.assertNotIn("start", self.mcu.calls)
        self.mcu.knob = 18
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        self.mcu.knob_stop()
        self.assertTrue(wait_for(lambda: p.state["playing"] is None), "didn't stop when the MCU did")

    def test_polls_when_the_bridge_cannot_provide(self):
        p = self.make(provide_ok=False)
        self.assertTrue(p.polling)
        p.play("Riptide")
        self.assertTrue(wait_for(lambda: len(self.bars) >= 3), "polling didn't see bars")
        self.assertEqual([b["chord"] for b in self.bars[:3]], ["Am", "G", "C"])
        self.mcu.gesture(-1)
        self.assertTrue(wait_for(lambda: p.state["playing"] != "Riptide"), "polling missed the knob double tap")
        self.mcu.knob_stop()
        self.assertTrue(wait_for(lambda: p.state["playing"] is None))

    def test_falls_back_to_polling_when_notify_never_arrives(self):
        old = player_mod.NOTIFY_WAIT_S
        player_mod.NOTIFY_WAIT_S = 0.3
        try:
            p = self.make(notify=False)
            self.assertFalse(p.polling)
            p.play("Strum")
            self.assertTrue(wait_for(lambda: len(self.bars) >= 2), "never fell back to polling")
            self.assertTrue(p.polling)
        finally:
            player_mod.NOTIFY_WAIT_S = old

    def test_debug_mode_mid_play_stops_the_board(self):
        p = self.make()
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        self.board.set_servos(False)
        p.settings_changed()
        self.assertTrue(wait_for(lambda: "stop" in self.mcu.calls), "board kept moving the servos")
        queued = len(self.mcu.queued)
        n = len(self.bars)
        self.assertTrue(wait_for(lambda: len(self.bars) > n + 1, 8), "bar time didn't carry on")
        self.assertEqual(len(self.mcu.queued), queued)  # nothing more for the board
        self.assertEqual(p.state["playing"], "Strum")

    def test_status_and_angles_during_play_reach_the_board(self):
        p = self.make()
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        for _ in range(50):
            self.assertTrue(self.board.set_angles(2, 70, 120)["ok"])
            self.assertNotEqual(self.board.stats(), {"board": "busy"})
        self.assertGreaterEqual(self.mcu.calls.count("angles"), 50)
        self.assertEqual(p.state["playing"], "Strum")


class MainTest(unittest.TestCase):
    """main.py imported for real, with a fake arduino module; its loop() is called by hand."""

    def load(self, **mcu):
        self.mcu = FakeMCU(bar_s=0.05, **mcu)
        self.ran = []
        app = types.SimpleNamespace(run=lambda user_loop=None: self.ran.append(user_loop))
        sys.modules.update({"arduino": types.ModuleType("arduino"),
                            "arduino.app_utils": types.SimpleNamespace(App=app, Bridge=self.mcu)})
        sys.modules.pop("main", None)
        self.main = importlib.import_module("main")
        return self.main

    def tearDown(self):
        self.main.player.stop_playing()
        wait_for(lambda: self.main.player.state["playing"] is None)
        self.mcu.halt.set()

    def test_starts_the_pattern_over_the_song(self):
        main = self.load()
        self.assertEqual(self.ran, [main.loop])  # the framework gets our loop
        self.assertEqual(self.mcu.calls, [])     # nothing is sent to the board before the loop runs
        main.loop()
        self.assertEqual(main.player.state["playing"], main.PATTERN)
        self.assertTrue(wait_for(lambda: len(self.mcu.queued) >= 2), "bars didn't reach the board")
        self.assertEqual(self.mcu.queued[0], encode_bar(PATTERNS[main.PATTERN], "Am"))
        self.assertEqual(self.mcu.queued[1], encode_bar(PATTERNS[main.PATTERN], "G"))
        self.assertEqual(self.mcu.calls.count("angles"), 6)  # saved pick angles sent once, before playing
        queued = len(self.mcu.queued)
        main.loop()  # already playing: nothing new is started
        self.assertEqual(self.mcu.calls.count("start"), 1)
        self.assertGreaterEqual(len(self.mcu.queued), queued)

    def test_knob_at_zero_stops_and_turning_it_up_starts_again(self):
        main = self.load()
        main.loop()
        self.assertTrue(wait_for(lambda: self.mcu.queued))
        self.mcu.knob = 0
        self.mcu.knob_stop()
        self.assertTrue(wait_for(lambda: main.player.state["playing"] is None))
        main.loop()
        self.assertIsNone(main.player.state["playing"])  # still at 0: stays stopped
        self.mcu.knob = 24
        main.loop()
        self.assertEqual(main.player.state["playing"], main.PATTERN)
        self.assertTrue(wait_for(lambda: self.mcu.calls.count("start") == 2))

    def test_without_a_knob_it_plays_at_bpm_and_does_not_restart_itself(self):
        main = self.load(knob=-1)
        main.loop()
        self.assertTrue(wait_for(lambda: self.mcu.running))
        self.assertEqual(self.mcu.bpm, main.BPM)
        main.player.stop_playing()
        self.assertTrue(wait_for(lambda: main.player.state["playing"] is None))
        main.loop()
        self.assertIsNone(main.player.state["playing"])

    def test_waits_while_the_board_does_not_answer(self):
        main = self.load()
        with main.board.lock:  # busy board
            main.loop()
        self.assertIsNone(main.player.state["playing"])
        self.assertFalse(main.started)
        main.loop()
        self.assertEqual(main.player.state["playing"], main.PATTERN)


if __name__ == "__main__":
    unittest.main()
