"""sqlite settings store and the .env reader."""

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

import _path  # noqa: F401
from strummer.config import read_env
from strummer.store import Store


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "data" / "strummer.db"  # data/ doesn't exist yet: Store makes it
        self.store = Store(self.path)

    def tearDown(self):
        self.store.close()
        self.dir.cleanup()

    def test_tables(self):
        tables = {r[0] for r in self.store._db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"settings", "sessions"} <= tables)
        self.assertEqual(self.store._db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)

    def test_settings_round_trip_and_survive_reopen(self):
        self.assertIsNone(self.store.get("angles"))
        self.assertEqual(self.store.get("angles", [1]), [1])
        self.store.set("angles", [[60, 120]] * 6)
        self.store.set("angles", [[70, 110]] * 6)  # overwrite, not a second row
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.get("angles"), [[70, 110]] * 6)

    def test_writes_from_many_threads(self):
        threads = [threading.Thread(target=self.store.set, args=(f"k{i}", i)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual([self.store.get(f"k{i}") for i in range(20)], list(range(20)))

    def test_migrates_angles_json_once(self):
        old = Path(self.dir.name) / "angles.json"
        angles = [[50 + i, 130 - i] for i in range(6)]
        old.write_text(json.dumps(angles))
        self.assertTrue(self.store.migrate_angles_json(old))
        self.assertEqual(self.store.get("angles"), angles)
        old.write_text(json.dumps([[60, 120]] * 6))
        self.assertFalse(self.store.migrate_angles_json(old))  # the store already has angles: keep them
        self.assertEqual(self.store.get("angles"), angles)

    def test_migration_skips_missing_or_broken_files(self):
        old = Path(self.dir.name) / "angles.json"
        self.assertFalse(self.store.migrate_angles_json(old))
        old.write_text("not json")
        self.assertFalse(self.store.migrate_angles_json(old))
        old.write_text("[[1, 2]]")
        self.assertFalse(self.store.migrate_angles_json(old))
        self.assertIsNone(self.store.get("angles"))


class SessionsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "strummer.db"
        self.store = Store(self.path)

    def tearDown(self):
        self.store.close()
        self.dir.cleanup()

    def test_score_and_accuracies(self):
        bars = [("Am", "hit"), ("G", "late"), ("C", "miss"), ("C", "hit"), ("Am", "silent")]
        s = self.store.save_session("riptide", 100, bars)
        self.assertEqual(s["score"], 50)  # (1 + .5 + 0 + 1 + 0) / 5
        self.assertEqual(s["chords"]["C"], {"accuracy": 50, "bars": 2})
        self.assertEqual(s["chords"]["G"], {"accuracy": 50, "bars": 1})
        # changes are the bar after a different chord: Am→G late, G→C miss, C→Am silent (C→C is no change)
        self.assertEqual(s["changes"], {"Am→G": {"accuracy": 50, "bars": 1}, "G→C": {"accuracy": 0, "bars": 1},
                                        "C→Am": {"accuracy": 0, "bars": 1}})

    def test_progress_survives_a_restart(self):
        self.store.save_session("riptide", 100, [("Am", "miss"), ("G", "hit")], started=1)
        self.store.save_session("riptide", 105, [("Am", "hit"), ("G", "hit")], started=2)
        self.store.save_session("blues-a", 90, [("A7", "hit"), ("D7", "miss")], started=3)
        self.store.close()
        self.store = Store(self.path)  # the app restarted
        p = self.store.progress()
        self.assertEqual(p["songs"]["riptide"]["best"], 100)
        self.assertEqual(p["songs"]["riptide"]["last"], 100)
        self.assertEqual([h["score"] for h in p["songs"]["riptide"]["history"]], [50, 100])
        self.assertEqual(p["songs"]["blues-a"]["last"], 50)
        self.assertEqual([r["song"] for r in p["recent"]], ["blues-a", "riptide", "riptide"])
        self.assertEqual(p["hardest"][0]["change"], "A7→D7")  # 0 %, the worst
        self.assertEqual(p["changes"]["Am→G"], {"accuracy": 100, "bars": 2})  # G→Am across two sessions isn't a change
        self.assertNotIn("G→Am", p["changes"])
        self.assertEqual(p["chords"]["Am"], {"accuracy": 50, "bars": 2})


class EnvTest(unittest.TestCase):
    def test_comments_quotes_and_missing_file(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, ".env"), "w") as f:
                f.write("# note\nELEVENLABS_API_KEY = 'abc=123'\n\nOTHER=x\nbroken line\n")
            self.assertEqual(read_env(os.path.join(d, ".env")), {"ELEVENLABS_API_KEY": "abc=123", "OTHER": "x"})
            self.assertEqual(read_env(os.path.join(d, "missing")), {})


if __name__ == "__main__":
    unittest.main()
