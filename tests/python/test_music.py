"""Every pattern must encode into messages the sketch accepts (CI has no board or Arduino core,
so this is the check that runs everywhere). Moved from tests/servo_strummer_test.sh."""

import random
import unittest

import _path  # noqa: F401
from strummer.music import (BAR_BEATS, CHORDS, MAX_CHUNK, MAX_SONG_BARS, PATTERNS, PROGRESSIONS, RANDOM,
                            bar, bar_chord, chord_strings, chunk_ms, next_pattern, parse_song, to_chunks, to_steps)


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
        for name, prog in PROGRESSIONS.items():
            self.assertTrue(name in PATTERNS and all(c in CHORDS for c in prog), name)

    def test_chosen_chord_beats_the_pattern_s_own(self):
        self.assertEqual([bar_chord("Riptide", None, i) for i in range(5)], ["Am", "G", "C", "C", "Am"])
        self.assertTrue(bar_chord("Riptide", "D", 1) == "D" and bar_chord("Strum", None, 3) is None)

    def test_loaded_song(self):
        # one chord per bar; beats the pattern's own chords, loses to a chosen chord
        song, err = parse_song("Am, G,C ,C")
        self.assertTrue(song == ["Am", "G", "C", "C"] and err is None)
        self.assertEqual([bar_chord("Strum", None, i, song) for i in range(5)], ["Am", "G", "C", "C", "Am"])
        self.assertTrue(bar_chord("Riptide", None, 1, ["D", "A"]) == "A" and bar_chord("Strum", "E", 1, song) == "E")
        self.assertTrue(bar_chord("Riptide", None, 1, None) == "G" and bar_chord("Riptide", None, 1, []) == "G")

    def test_parse_song_errors(self):
        self.assertEqual(parse_song(""), ([], None))
        self.assertIsNone(parse_song("Am,H")[0])
        self.assertIn("H", parse_song("Am,H")[1])
        self.assertIsNone(parse_song(",".join(["C"] * (MAX_SONG_BARS + 1)))[0])


if __name__ == "__main__":
    unittest.main()
