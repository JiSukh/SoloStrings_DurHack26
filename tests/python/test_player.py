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
from strummer.board import Board
from strummer.player import Player


class FakeBridge:
    """Records every call; knob at 18 clicks (90 BPM), no knob presses."""

    def __init__(self, knob=18):
        self.calls = []
        self.knob = knob

    def call(self, name, *args, **kw):
        self.calls.append(name)
        return self.knob if name == "knob" else (0 if name == "knob_click" else True)


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
        moving = {"play", "reset", "angles"}
        self.assertFalse(moving & set(calls), f"debug mode moved servos: {sorted(moving & set(calls))}")
        main.set_servos(True)
        # back on: angles resent, then the pluck
        self.assertTrue(main.pluck(0)["ok"] and "play" in calls and "angles" in calls)
        self.assertEqual(main.store.get("angles")[1], [70, 120])  # saved in sqlite

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
