"""Storage: one sqlite file (stdlib sqlite3), servo-strummer/data/strummer.db by default.

Tables:
  settings  key -> JSON value (today: "angles", the pick end angles per string)
  sessions  practice sessions; empty until the practice coach (#6) fills it
"""

import json
import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started REAL NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
);
"""


class Store:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)  # requests come from many threads
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.executescript(SCHEMA)

    def get(self, key, default=None):
        with self._lock:
            row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self._lock, self._db:
            self._db.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                             "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))

    def migrate_angles_json(self, path):
        """First start after the move to sqlite: take the angles from the old angles.json.
        Does nothing once the store has angles, or when the file is missing or broken."""
        if self.get("angles") is not None:
            return False
        try:
            angles = json.loads(Path(path).read_text())
        except (OSError, ValueError):
            return False
        if not (isinstance(angles, list) and len(angles) == 6 and all(len(a) == 2 for a in angles)):
            return False
        self.set("angles", angles)
        return True

    def close(self):
        with self._lock:
            self._db.close()
