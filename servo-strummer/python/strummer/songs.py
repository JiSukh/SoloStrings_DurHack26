"""Songs to practise: chord progressions only (one chord per bar), never lyrics.

Each song names the pattern the robot plays and a starting tempo. Served by GET /songs; the
practice view loads one with POST /song (the same loader as Ray's voice "custom song").
"""

from .music import CHORDS, PATTERNS

SONGS = [
    {"id": "riptide", "name": "Riptide", "chords": ["Am", "G", "C", "C"], "pattern": "Island strum", "bpm": 100},
    {"id": "four-chord", "name": "Four-chord pop", "chords": ["G", "D", "Em", "C"], "pattern": "Strum", "bpm": 90},
    {"id": "blues-a", "name": "12-bar blues in A",
     "chords": ["A7", "A7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"], "pattern": "Boom-chick", "bpm": 90},
    {"id": "g-c-d", "name": "G–C–D", "chords": ["G", "C", "D", "D"], "pattern": "Folk (D DU UDU)", "bpm": 80},
    {"id": "em-c-g-d", "name": "Em–C–G–D", "chords": ["Em", "C", "G", "D"], "pattern": "Down-up eighths", "bpm": 80},
    {"id": "am-f-c-g", "name": "Am–F–C–G", "chords": ["Am", "F", "C", "G"], "pattern": "Travis picking", "bpm": 70},
]

BY_ID = {s["id"]: s for s in SONGS}

for _s in SONGS:  # a typo here would only show up at the robot
    assert _s["pattern"] in PATTERNS and all(c in CHORDS for c in _s["chords"]), _s["id"]
