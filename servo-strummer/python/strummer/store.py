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


GRADES = ("hit", "late", "miss", "silent")  # silent = no confident mic reading that bar
CREDIT = {"hit": 1.0, "late": 0.5, "miss": 0.0, "silent": 0.0}


def _acc(points, bars):
    return int(100 * points / bars + 0.5) if bars else 0  # halves up, like Math.round in grade.ts


def summarise(results, bars_by_session=None):
    """[(chord, grade)] per bar -> score (0-100: hit 1, late 1/2), and accuracy per chord and per
    change ("Am→G": the bar after a chord change). Same rules as web/src/lib/practice/grade.ts.
    bars_by_session: count changes within each session only (not across two sessions' seam)."""
    chords, changes = {}, {}
    for c, g in results:
        e = chords.setdefault(c, [0.0, 0])
        e[0] += CREDIT[g]
        e[1] += 1
    for bars in (bars_by_session if bars_by_session is not None else [results]):
        for (prev, _), (c, g) in zip(bars, bars[1:]):
            if prev != c:
                e = changes.setdefault(f"{prev}→{c}", [0.0, 0])
                e[0] += CREDIT[g]
                e[1] += 1
    points = sum(CREDIT[g] for _, g in results)
    return {"score": _acc(points, len(results)),
            "chords": {k: {"accuracy": _acc(p, n), "bars": n} for k, (p, n) in chords.items()},
            "changes": {k: {"accuracy": _acc(p, n), "bars": n} for k, (p, n) in changes.items()}}


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

    # --- practice sessions (the practice coach) ---

    def save_session(self, song, bpm, results, started=None):
        """results: [(chord, grade)] per bar, grade one of GRADES. Returns the stored session."""
        import time
        results = [[c, g] for c, g in results]
        session = {"song": song, "bpm": bpm, "results": results, **summarise(results)}
        with self._lock, self._db:
            cur = self._db.execute("INSERT INTO sessions (started, data) VALUES (?, ?)",
                                   (started if started is not None else time.time(), json.dumps(session)))
        return {"id": cur.lastrowid, **session}

    def sessions(self):
        with self._lock:
            rows = self._db.execute("SELECT id, started, data FROM sessions ORDER BY started, id").fetchall()
        return [{"id": i, "started": t, **json.loads(d)} for i, t, d in rows]

    def progress(self, recent=10):
        """Best and last score per song, with its history; per-chord and per-change accuracy over
        every session; the hardest changes first; and the most recent sessions."""
        sessions = self.sessions()
        songs = {}
        for s in sessions:
            e = songs.setdefault(s["song"], {"best": 0, "last": 0, "history": []})
            e["best"] = max(e["best"], s["score"])
            e["last"] = s["score"]
            e["history"].append({"at": s["started"], "score": s["score"], "bpm": s["bpm"]})
        everything = summarise([r for s in sessions for r in s["results"]],
                               bars_by_session=[s["results"] for s in sessions])
        hardest = sorted(everything["changes"].items(), key=lambda kv: (kv[1]["accuracy"], -kv[1]["bars"]))
        return {"songs": songs, "chords": everything["chords"], "changes": everything["changes"],
                "hardest": [{"change": k, **v} for k, v in hardest if v["accuracy"] < 100][:5],
                "recent": [{k: s[k] for k in ("id", "started", "song", "bpm", "score")} for s in sessions[-recent:]][::-1]}

    def close(self):
        with self._lock:
            self._db.close()
