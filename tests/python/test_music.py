"""Every pattern must encode into messages the sketch accepts (CI has no board or Arduino core,
so this is the check that runs everywhere). Moved from tests/servo_strummer_test.sh."""

import random
import unittest

import _path  # noqa: F401
from strummer.music import (BAR_BEATS, CHORDS, KIND_DOWN, KIND_UP, MAX_BAR_CHARS, MAX_CHUNK, MAX_SONG_BARS,
                            PATTERNS, RANDOM, SUB_PER_TICK, _voice, bar, bar_chord, chord_strings,
                            chunk_ms, encode_bar, next_pattern, parse_bar, parse_song, simulate, to_chunks, to_steps)


def all_bars():
    rng = random.Random(1)
    return list(PATTERNS.items()) + [(f"{RANDOM} {i}", bar(RANDOM, rng)) for i in range(300)]


class Patterns(unittest.TestCase):
    def test_enough_patterns(self):
        self.assertGreaterEqual(len(PATTERNS), 10)

    def test_every_bar_is_one_4_4_bar(self):
        for name, pat in all_bars():
            self.assertLess(abs(sum(b for _, _, b in pat) - BAR_BEATS), 1e-9, name)

    def test_chord_shapes(self):
        for shape in CHORDS.values():
            self.assertTrue(len(shape) == 6 and all(c in "x0123456789" for c in shape), shape)

    def test_every_bar_encodes_for_the_sketch(self):
        for name, pat in all_bars():
            for chord in [None] + list(CHORDS):
                allowed = sum(1 << s for s in chord_strings(chord))
                for bpm in (30, 90, 200):
                    steps = to_steps(pat, bpm, chord)
                    self.assertTrue(all(m & ~allowed == 0 for m, _ in steps), (name, chord))  # never a muted string
                    for mask, ms in steps:
                        self.assertTrue(0 <= mask < 64, (name, mask))          # sketch rejects masks over 6 bits
                        self.assertTrue(ms >= 20 and ms % 20 == 0, (name, ms))  # whole 20 ms servo frames
                        self.assertLessEqual(ms, 10000, (name, ms))           # sketch rejects longer steps
                    chunks = to_chunks(steps)
                    self.assertTrue(all(len(c) <= MAX_CHUNK for c in chunks), name)
                    self.assertEqual(",".join(chunks), ",".join(f"{m}:{t}" for m, t in steps), name)  # nothing lost
                    beats = sum(b for _, _, b in pat)
                    expected = beats * 60000 / bpm
                    got = sum(chunk_ms(c) for c in chunks)
                    self.assertLessEqual(abs(got - expected), 20 * len(steps), (name, bpm, got, expected))  # drift ≤ rounding

    def test_chords_voice_the_bass(self):
        # D never touches low E or A; Travis bass follows the root
        self.assertTrue(all(m & 0b11 == 0 for m, _ in to_steps(PATTERNS["Travis picking"], 90, "D")))
        self.assertEqual(to_steps(PATTERNS["Travis picking"], 90, "C")[0][0], (1 << 1) | (1 << 5))  # A + high e
        self.assertEqual(to_steps(PATTERNS["Travis picking"], 90, "G")[0][0], 1 | (1 << 5))         # low E + high e

    def test_super_human_gives_each_servo_time(self):
        # no string is plucked again within 3 steps (an SG90 needs ~160 ms at 200 BPM)
        for chord in [None] + list(CHORDS):
            # rests take time too; *2 = across the bar line
            masks = [m for m, _ in to_steps(PATTERNS["Super-human (32nds)"], 200, chord)] * 2
            for i, m in enumerate(masks):
                self.assertTrue(all(m & n == 0 for n in masks[i + 1:i + 4]), (chord, i))
            if chord is None:
                self.assertEqual(sum(set(masks)), 63)  # every string gets played

    def test_strum_direction(self):
        # a down strum plucks low E first, an up strum high e first
        self.assertEqual(to_steps([("d", [0, 1, 2, 3, 4, 5], 1)], 60)[0][0], 1)
        self.assertEqual(to_steps([("u", [0, 1, 2, 3, 4, 5], 1)], 60)[0][0], 32)
        self.assertEqual([k for k, _, _ in PATTERNS["Strum"]], ["d", "u", "d", "u"])


class Knob(unittest.TestCase):
    def test_button_steps_through_every_pattern_and_wraps(self):
        names, n = [], list(PATTERNS)[0]
        for _ in range(len(PATTERNS) + 2):
            names.append(n)
            n = next_pattern(n)
        self.assertTrue(names[-2] == RANDOM and names[-1] == names[0] and len(set(names)) == len(PATTERNS) + 1)
        # double tap goes back
        self.assertTrue(next_pattern(names[0], -1) == RANDOM and next_pattern(RANDOM, -1) == names[-3])


class Songs(unittest.TestCase):
    def test_progressions_use_real_chords(self):
        from strummer.songs import SONGS
        for s in SONGS:
            self.assertTrue(s["pattern"] in PATTERNS and all(c in CHORDS for c in s["chords"]), s["id"])

    def test_chosen_chord_beats_the_pattern_s_own(self):
        riptide = ["Am", "G", "C", "C"]
        self.assertEqual([bar_chord("Island strum", None, i, riptide) for i in range(5)], ["Am", "G", "C", "C", "Am"])
        self.assertTrue(bar_chord("Island strum", "D", 1, riptide) == "D" and bar_chord("Strum", None, 3) is None)
        self.assertIsNone(bar_chord("Island strum", None, 1))  # no song: every string, whatever the pattern

    def test_loaded_song(self):
        # one chord per bar; beats the pattern's own chords, loses to a chosen chord
        song, err = parse_song("Am, G,C ,C")
        self.assertTrue(song == ["Am", "G", "C", "C"] and err is None)
        self.assertEqual([bar_chord("Strum", None, i, song) for i in range(5)], ["Am", "G", "C", "C", "Am"])
        self.assertTrue(bar_chord("Island strum", None, 1, ["D", "A"]) == "A" and bar_chord("Strum", "E", 1, song) == "E")
        self.assertTrue(bar_chord("Island strum", None, 1, None) is None and bar_chord("Island strum", None, 1, []) is None)

    def test_parse_song_errors(self):
        self.assertEqual(parse_song(""), ([], None))
        self.assertIsNone(parse_song("Am,H")[0])
        self.assertIn("H", parse_song("Am,H")[1])
        self.assertIsNone(parse_song(",".join(["C"] * (MAX_SONG_BARS + 1)))[0])


class SequencerBars(unittest.TestCase):
    """encode_bar() / simulate(): the bars the MCU sequencer plays (sketch/sequencer.h)."""

    def test_golden_vectors_are_current(self):
        # tests/bar_vectors.json is what sequencer_test.cpp checks the C++ against; if this fails
        # after a deliberate change, regenerate it: python3 tests/python/bar_vectors.py
        import bar_vectors
        self.assertEqual(bar_vectors.FILE.read_text(), bar_vectors.dumps(bar_vectors.build()))

    def test_format(self):
        self.assertEqual(encode_bar(PATTERNS["Strum"]), "96;0:127,24:191,48:127,72:191")
        # Travis on C: R = A string (1), R2 = D (2); pinch A + high e on beat one
        self.assertEqual(encode_bar(PATTERNS["Travis picking"], "C"), "96;0:34,12:8,24:4,36:16,48:2,60:8,72:4,84:16")
        # rests take no event; the reggae skank's up-chops are strums
        self.assertEqual(encode_bar(PATTERNS["Reggae skank"]), "96;24:184,72:184")
        self.assertEqual(parse_bar("96;0:127,24:191"), (96, [(0, 127), (24, 191)]))
        self.assertEqual(parse_bar("96;"), (96, []))

    def test_every_bar_fits_and_never_plays_a_muted_string(self):
        for name, pat in all_bars():
            for chord in [None] + list(CHORDS):
                code = encode_bar(pat, chord)
                self.assertLessEqual(len(code), MAX_BAR_CHARS, (name, chord))
                length, events = parse_bar(code)
                self.assertEqual(length, 96)
                allowed = sum(1 << s for s in chord_strings(chord))
                ticks = [t for t, _ in events]
                self.assertEqual(ticks, sorted(ticks), name)
                self.assertLessEqual(len(events), 48, name)  # seq::MAX_EVENTS
                for t, m in events:
                    self.assertTrue(0 <= t < 96 and m & 63 and m & ~allowed & 63 == 0, (name, chord, t, m))
                    self.assertFalse(m & KIND_DOWN and m & KIND_UP)

    def test_strums_list_strings_low_to_high(self):
        # the MCU ripples a strum in string order (down = low to high); to_steps uses the
        # pattern's order, so every strum must list its strings low to high for both to agree
        for name, pat in all_bars():
            for kind, strings, _ in pat:
                if kind in ("d", "u"):
                    self.assertEqual(list(strings), sorted(strings), name)

    def test_sequencer_plays_every_pluck_on_time(self):
        # Every string the old step list plucks, the sequencer plucks too, each within half a
        # frame (10 ms) of its exact time; strums ripple 20 ms per string as before.
        for name, pat in all_bars()[:60]:
            for chord in [None] + list(CHORDS):
                for bpm in (30, 90, 200):
                    bar_ms = BAR_BEATS * 60000 / bpm
                    want = {s: [] for s in range(6)}
                    beats = 0.0
                    allowed = chord_strings(chord)
                    for kind, strings, length in pat:
                        voiced = _voice(strings, allowed)
                        t = beats * 60000 / bpm
                        if kind in ("d", "u") and len(voiced) > 1:
                            order = voiced if kind == "d" else list(reversed(voiced))
                            for k, s in enumerate(order):
                                want[s].append(t + 20 * k)
                        else:
                            for s in voiced:
                                want[s].append(t)
                        beats += length
                    code = encode_bar(pat, chord)
                    line = next(f for f in range(10 ** 6) if 2 * f * bpm + bpm > 2 * 96 * SUB_PER_TICK)  # bar 2 starts
                    got = {s: [] for s in range(6)}
                    for frame, mask in simulate(code, bpm, line):
                        for s in range(6):
                            if mask >> s & 1:
                                got[s].append(frame * 20)
                    for s in range(6):
                        self.assertEqual(len(got[s]), len(want[s]), (name, chord, bpm, s))
                        for g, w in zip(got[s], want[s]):
                            self.assertLessEqual(abs(g - w), 10 + 1e-6, (name, chord, bpm, s, g, w))
                    self.assertLess(max((t for ts in want.values() for t in ts), default=0), bar_ms)

    def test_simulate_loops_the_bar(self):
        # 120 BPM: a bar is 100 frames; it loops with nothing new queued
        self.assertEqual(simulate("96;0:1,48:2", 120, 201), [[0, 1], [50, 2], [100, 1], [150, 2], [200, 1]])
        # strum down then up across all six strings
        self.assertEqual(simulate("96;0:127", 120, 7), [[0, 1], [1, 2], [2, 4], [3, 8], [4, 16], [5, 32]])
        self.assertEqual(simulate("96;0:191", 120, 7), [[0, 32], [1, 16], [2, 8], [3, 4], [4, 2], [5, 1]])


if __name__ == "__main__":
    unittest.main()
