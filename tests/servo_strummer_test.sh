#!/usr/bin/env bash
# servo-strummer: Python must compile, and every pattern must encode into messages the sketch accepts
# (CI has no board or Arduino core, so this is the check that runs everywhere).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile servo-strummer/python/*.py
python3 -I - servo-strummer/python <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from patterns import CHORDS, PATTERNS, to_steps, to_chunks, chunk_ms, chord_strings, MAX_CHUNK
assert len(PATTERNS) >= 10
import random
from patterns import BAR_BEATS, RANDOM, bar
rng = random.Random(1)
bars = list(PATTERNS.items()) + [(f"{RANDOM} {i}", bar(RANDOM, rng)) for i in range(300)]
for name, pat in bars:
    assert abs(sum(b for _, _, b in pat) - BAR_BEATS) < 1e-9, name  # one 4/4 bar each
for shape in CHORDS.values():
    assert len(shape) == 6 and all(c in "x0123456789" for c in shape), shape
for name, pat in bars:
  for chord in [None] + list(CHORDS):
    allowed = sum(1 << s for s in chord_strings(chord))
    for bpm in (30, 90, 200):
        steps = to_steps(pat, bpm, chord)
        assert all(m & ~allowed == 0 for m, _ in steps), (name, chord)  # never a muted string
        for mask, ms in steps:
            assert 0 <= mask < 64, (name, mask)          # sketch rejects masks over 6 bits
            assert ms >= 20 and ms % 20 == 0, (name, ms)  # whole 20 ms servo frames
            assert ms <= 10000, (name, ms)               # sketch rejects longer steps
        chunks = to_chunks(steps)
        assert all(len(c) <= MAX_CHUNK for c in chunks), name
        assert ",".join(chunks) == ",".join(f"{m}:{t}" for m, t in steps), name  # nothing lost
        beats = sum(b for _, _, b in pat)
        expected = beats * 60000 / bpm
        got = sum(chunk_ms(c) for c in chunks)
        assert abs(got - expected) <= 20 * len(steps), (name, bpm, got, expected)  # timing drift ≤ rounding
# chords: D never touches low E or A; Travis bass follows the root
assert all(m & 0b11 == 0 for m, _ in to_steps(PATTERNS["Travis picking"], 90, "D"))
assert to_steps(PATTERNS["Travis picking"], 90, "C")[0][0] == (1 << 1) | (1 << 5)  # A + high e
assert to_steps(PATTERNS["Travis picking"], 90, "G")[0][0] == 1 | (1 << 5)        # low E + high e
# super-human: no string is plucked again within 3 steps (an SG90 needs ~160 ms at 200 BPM)
for chord in [None] + list(CHORDS):
    masks = [m for m, _ in to_steps(PATTERNS["Super-human (32nds)"], 200, chord)] * 2  # rests take time too; *2 = across the bar line
    for i, m in enumerate(masks):
        assert all(m & n == 0 for n in masks[i + 1:i + 4]), (chord, i)
    if chord is None:
        assert sum(set(masks)) == 63  # every string gets played
# knob button: steps through every pattern, Random included, and wraps round
from patterns import next_pattern
names, n = [], list(PATTERNS)[0]
for _ in range(len(PATTERNS) + 2):
    names.append(n); n = next_pattern(n)
assert names[-2] == RANDOM and names[-1] == names[0] and len(set(names)) == len(PATTERNS) + 1
assert next_pattern(names[0], -1) == RANDOM and next_pattern(RANDOM, -1) == names[-3]  # double tap goes back
assert [k for k, _, _ in PATTERNS["Strum"]] == ["d", "u", "d", "u"]
# songs: progressions use real chords; a chosen chord wins over the song's
from patterns import PROGRESSIONS, bar_chord
for name, prog in PROGRESSIONS.items():
    assert name in PATTERNS and all(c in CHORDS for c in prog), name
assert [bar_chord("Riptide", None, i) for i in range(5)] == ["Am", "G", "C", "C", "Am"]
assert bar_chord("Riptide", "D", 1) == "D" and bar_chord("Strum", None, 3) is None
# a loaded song (voice / coach): one chord per bar; beats the pattern's own chords, loses to a chosen chord
from patterns import parse_song, MAX_SONG_BARS
song, err = parse_song("Am, G,C ,C")
assert song == ["Am", "G", "C", "C"] and err is None
assert [bar_chord("Strum", None, i, song) for i in range(5)] == ["Am", "G", "C", "C", "Am"]
assert bar_chord("Riptide", None, 1, ["D", "A"]) == "A" and bar_chord("Strum", "E", 1, song) == "E"
assert bar_chord("Riptide", None, 1, None) == "G" and bar_chord("Riptide", None, 1, []) == "G"
assert parse_song("") == ([], None) and parse_song("Am,H")[0] is None and "H" in parse_song("Am,H")[1]
assert parse_song(",".join(["C"] * (MAX_SONG_BARS + 1)))[0] is None
# .env reader: comments, quotes and a missing file
import os, tempfile
from config import read_env
with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, ".env"), "w") as f:
        f.write("# note\nELEVENLABS_API_KEY = 'abc=123'\n\nOTHER=x\nbroken line\n")
    assert read_env(os.path.join(d, ".env")) == {"ELEVENLABS_API_KEY": "abc=123", "OTHER": "x"}
    assert read_env(os.path.join(d, "missing")) == {}
# debug mode: with the servos off, nothing that moves them reaches the board, timing still runs
import types, time as _time
calls = []
class FakeBridge:
    @staticmethod
    def call(name, *args, **kw):
        calls.append(name)
        return 18 if name == "knob" else (0 if name == "knob_click" else True)
app_utils = types.SimpleNamespace(App=types.SimpleNamespace(run=lambda: None), Bridge=FakeBridge)
web_ui = types.SimpleNamespace(WebUI=lambda: types.SimpleNamespace(expose_api=lambda *a: None))
sys.modules.update({"arduino": types.ModuleType("arduino"), "arduino.app_utils": app_utils,
                    "arduino.app_bricks": types.ModuleType("arduino.app_bricks"), "arduino.app_bricks.web_ui": web_ui})
import main
main.ANGLES_FILE = main.Path(tempfile.mkdtemp()) / "angles.json"  # don't touch the real one
main.set_servos(False)
assert main.pluck(0)["ok"] and main.reset()["ok"] and main.set_angles(1, 70, 120)["ok"]
main.play("Strum"); _time.sleep(0.3); main.stop_playing()
for _ in range(100):
    if main.state["playing"] is None: break
    _time.sleep(0.05)
assert main.state["playing"] is None, "debug play didn't stop"
moving = {"play", "reset", "angles"}
assert not moving & set(calls), f"debug mode moved servos: {sorted(moving & set(calls))}"
main.set_servos(True)
assert main.pluck(0)["ok"] and "play" in calls and "angles" in calls  # back on: angles resent, then the pluck
# a down strum plucks low E first, an up strum high e first
assert to_steps([("d", [0, 1, 2, 3, 4, 5], 1)], 60)[0][0] == 1
assert to_steps([("u", [0, 1, 2, 3, 4, 5], 1)], 60)[0][0] == 32
PY
if command -v node >/dev/null; then node tests/recognise_test.mjs; node tests/listen_test.mjs; node tests/twin_test.mjs; node tests/voice_test.mjs; else echo "recognise_test, listen_test: skipped (no node)"; fi
echo "servo_strummer_test: ok"
