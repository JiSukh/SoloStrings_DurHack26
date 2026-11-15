"""The bar loop and main.py's wiring, against a fake Bridge (no board, no Arduino packages)."""

import importlib
import os
import sys
import tempfile
import threading
import time
import types
import unittest

import _path  # noqa: F401
from strummer import player as player_mod

# Names the sketch provides; Python can't provide a notification handler under any of them.
import re
from pathlib import Path
_SKETCH = Path(__file__).resolve().parents[2] / "servo-strummer" / "sketch" / "sketch.ino"
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
        self.button = 0  # a press waiting to be read: 1 = start, -1 = stop

    def call(self, name, *args, **kw):
        self.calls.append(name)
        if name == "button":
            press, self.button = self.button, 0
            return press
        return self.knob if name == "knob" else (0 if name == "knob_click" else True)


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
        self.assertEqual(set(bar), {"start", "steps", "chord", "next"})
        self.assertEqual(self.states[0]["playing"], "Strum")
        self.assertEqual(self.player.state["knob_bpm"], 90)
        self.player.stop_playing()
        self.assertTrue(wait_for(lambda: self.player.state["playing"] is None), "didn't stop")
        self.assertIsNone(self.states[-1]["playing"])  # the stop was reported too
        self.assertFalse(self.board.lock.locked())

    def test_switching_and_settings_report_state(self):
        self.player.play("Strum")
        n = len(self.states)
        self.assertTrue(self.player.play("Island strum")["switched"])
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
        r = self.player.set_song("Am,G,C,C") and self.player.steps("Island strum", 90, "", 1)
        self.assertTrue(r["ok"] and r["chord"] == "G" and r["next"] == "C" and r["steps"])
        self.assertFalse(self.player.steps("Island strum", 90, "H")["ok"])

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
        p.set_song("Am,G,C,C")  # Riptide, as songs.py has it
        self.assertTrue(p.play("Island strum")["ok"])
        self.assertTrue(wait_for(lambda: len(self.bars) >= 5), "bars didn't arrive")
        self.assertEqual([b["chord"] for b in self.bars[:5]], ["Am", "G", "C", "C", "Am"])
        self.assertEqual([b["next"] for b in self.bars[:4]], ["G", "C", "C", "Am"])
        self.assertEqual(self.mcu.shown[:4], ["Am", "G", "C", "Am"])  # the LED follows the bar (C, C sent once)
        # one bar queued ahead: the first before start, then one per bar notification
        self.assertEqual(self.mcu.queued[0], encode_bar(PATTERNS["Island strum"], "Am"))
        self.assertEqual(self.mcu.queued[1], encode_bar(PATTERNS["Island strum"], "G"))
        self.assertLess(self.mcu.calls.index("queue"), self.mcu.calls.index("start"))
        self.assertEqual(self.player.state["knob_bpm"], 90)

    def test_knob_press_switches_pattern_at_the_bar(self):
        p = self.make(bar_s=0.3)
        p.play("Strum")
        self.assertTrue(wait_for(lambda: self.bars))
        n = len(self.mcu.queued)
        self.mcu.gesture(1)
        self.assertTrue(wait_for(lambda: len(self.mcu.queued) > n))  # re-queued at once
        self.assertEqual(p.state["playing"], "Down-up eighths")
        self.assertEqual(self.mcu.queued[-1], encode_bar(PATTERNS["Down-up eighths"]))
        self.mcu.gesture(-1)  # double tap: back
        self.assertTrue(wait_for(lambda: p.state["playing"] == "Strum"))

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
        p.set_song("Am,G,C,C")
        p.play("Island strum")
        self.assertTrue(wait_for(lambda: len(self.bars) >= 3), "polling didn't see bars")
        self.assertEqual([b["chord"] for b in self.bars[:3]], ["Am", "G", "C"])
        self.mcu.gesture(1)
        self.assertTrue(wait_for(lambda: p.state["playing"] != "Island strum"), "polling missed the knob press")
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
    """main.py imported for real, with fake arduino modules."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["STRUMMER_DB"] = os.path.join(cls.tmp.name, "strummer.db")  # don't touch the real one
        cls.bridge = FakeBridge()
        cls.pushed = []
        ui = types.SimpleNamespace(expose_api=lambda *a: None,
                                   send_message=lambda kind, msg: cls.pushed.append((time.time(), kind, msg)))
        app_utils = types.SimpleNamespace(App=types.SimpleNamespace(run=lambda: None), Bridge=cls.bridge)
        web_ui = types.SimpleNamespace(WebUI=lambda: ui)
        sys.modules.update({"arduino": types.ModuleType("arduino"), "arduino.app_utils": app_utils,
                            "arduino.app_bricks": types.ModuleType("arduino.app_bricks"),
                            "arduino.app_bricks.web_ui": web_ui})
        sys.modules.pop("main", None)
        cls.main = importlib.import_module("main")

    @classmethod
    def tearDownClass(cls):
        cls.main.store.close()
        os.environ.pop("STRUMMER_DB", None)
        cls.tmp.cleanup()

    def test_debug_mode_never_moves_servos(self):
        # debug mode: with the servos off, nothing that moves them reaches the board, timing still runs
        main, calls = self.main, self.bridge.calls
        main.set_servos(False)
        self.assertTrue(main.pluck(0)["ok"] and main.reset()["ok"] and main.set_angles(1, 70, 120)["ok"])
        main.play("Strum")
        time.sleep(0.3)
        main.stop_playing()
        self.assertTrue(wait_for(lambda: main.player.state["playing"] is None), "debug play didn't stop")
        moving = {"play", "reset", "angles", "queue", "start", "stop"}
        self.assertFalse(moving & set(calls), f"debug mode moved servos: {sorted(moving & set(calls))}")
        main.set_servos(True)
        # back on: angles resent, then the pluck
        self.assertTrue(main.pluck(0)["ok"] and "play" in calls and "angles" in calls)
        self.assertEqual(main.store.get("angles")[1], [70, 120])  # saved in sqlite

    def test_buttons_start_and_stop(self):
        # D3 starts the last pattern played (Strum before anything has played), D5 stops
        main, bridge = self.main, self.bridge
        main.set_servos(False)  # debug mode: no servo calls, bar time runs in Python
        try:
            bridge.button = 1
            self.assertTrue(wait_for(lambda: main.player.state["playing"] == "Strum"), "start button didn't play")
            main.play("Folk (D DU UDU)")  # switches at the bar; the watcher remembers it
            time.sleep(main.KNOB_WATCH_S * 2)
            bridge.button = -1
            self.assertTrue(wait_for(lambda: main.player.state["playing"] is None), "stop button didn't stop")
            bridge.button = 1
            self.assertTrue(wait_for(lambda: main.player.state["playing"] == "Folk (D DU UDU)"),
                            "start didn't replay the last pattern")
            bridge.button = -1
            self.assertTrue(wait_for(lambda: main.player.state["playing"] is None))
        finally:
            main.set_servos(True)

    def test_state_is_pushed_within_a_second(self):
        main = self.main
        t = time.time()
        main.set_chord("G")
        self.assertTrue(wait_for(lambda: any(k == "state" and m["chord"] == "G" for _, k, m in self.pushed), 1))
        when = next(w for w, k, m in self.pushed if k == "state" and m["chord"] == "G")
        self.assertLess(when - t, 1)
        main.set_chord("")

    def test_bar_pushed_at_each_bar(self):
        main = self.main
        main.set_servos(False)
        main.play("Strum")
        self.assertTrue(wait_for(lambda: any(k == "bar" for _, k, _m in self.pushed)))
        main.stop_playing()
        self.assertTrue(wait_for(lambda: main.player.state["playing"] is None))
        bar = next(m for _, k, m in self.pushed if k == "bar")
        self.assertTrue({"start", "steps", "chord", "next", "now"} <= set(bar))

    def test_knob_watcher_pushes_when_the_knob_moves(self):
        main = self.main
        self.bridge.knob = 24  # 120 BPM
        self.assertTrue(wait_for(lambda: any(k == "state" and m["knob_bpm"] == 120
                                             for _, k, m in self.pushed), 2), "knob move not pushed")
        self.bridge.knob = 18

    def test_status_still_answers(self):
        s = self.main.status()
        self.assertTrue({"playing", "chord", "bpm", "knob_bpm", "bar", "song", "servos", "angles", "now"} <= set(s))

    def test_pluck_and_reset_wait_for_stop(self):
        main = self.main
        main.set_servos(False)
        main.play("Strum")
        self.assertTrue(wait_for(lambda: main.player.state["bar"]))
        self.assertEqual(main.pluck(0)["error"], "stop the pattern first")
        self.assertEqual(main.reset()["error"], "stop the pattern first")
        main.stop_playing()
        self.assertTrue(wait_for(lambda: main.player.state["playing"] is None))

    def test_songs_sessions_progress(self):
        main = self.main
        songs = {s["id"]: s for s in main.songs()["songs"]}
        self.assertEqual(songs["riptide"]["chords"], ["Am", "G", "C", "C"])
        self.assertEqual(songs["riptide"]["pattern"], "Island strum")
        self.assertEqual(len(songs["blues-a"]["chords"]), 12)
        r = main.save_session("riptide", 100, "Am:hit,G:hit,C:late,C:miss")
        self.assertTrue(r["ok"])
        self.assertEqual(r["session"]["score"], 63)  # 2.5 / 4
        self.assertTrue(main.save_session("loop:Am-G", 80, "Am:hit,G:hit")["ok"])  # a 2-chord practice loop
        self.assertFalse(main.save_session("nope", 100, "Am:hit")["ok"])
        self.assertFalse(main.save_session("riptide", 100, "Am:great")["ok"])
        self.assertFalse(main.save_session("riptide", 100, "")["ok"])
        self.assertEqual(main.progress()["songs"]["riptide"]["last"], 63)

    def test_routes_answer_as_before(self):
        main = self.main
        self.assertIn("Random", main.patterns()["patterns"])
        self.assertIn("Am", main.chords()["chords"])
        self.assertFalse(main.set_angles(9, 70, 120)["ok"])
        self.assertTrue(main.set_song("Am,G")["ok"] and main.set_song("")["song"] is None)
        self.assertTrue(main.set_tempo(100)["ok"])
        self.assertTrue(main.steps("Strum")["ok"])
        self.assertIn("elevenlabs_key", main.config())
        self.assertIn("board", main.debug())
        self.assertFalse(main.pluck(7)["ok"])


if __name__ == "__main__":
    unittest.main()
