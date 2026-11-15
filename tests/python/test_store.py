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


class EnvTest(unittest.TestCase):
    def test_comments_quotes_and_missing_file(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, ".env"), "w") as f:
                f.write("# note\nELEVENLABS_API_KEY = 'abc=123'\n\nOTHER=x\nbroken line\n")
            self.assertEqual(read_env(os.path.join(d, ".env")), {"ELEVENLABS_API_KEY": "abc=123", "OTHER": "x"})
            self.assertEqual(read_env(os.path.join(d, "missing")), {})


if __name__ == "__main__":
    unittest.main()
