"""Music: chords, picking/strumming patterns, and encoding them for the sketch's "play" call.

Strings: 0 = low E, 1 = A, 2 = D, 3 = G, 4 = B, 5 = high e.
Each event is (kind, strings, beats):
  "p"  pluck the strings together (a pinch if several)
  "d"  strum down: strings plucked one after another, low to high
  "u"  strum up: high to low
  "r"  rest
Every pluck flips that string's pick to the other side, like a real pick stroke.

Plucks can name roles instead of strings: R = the chord's bass (root) string, R2 = the
alternating bass. With a chord set, strums skip strings the chord mutes, and a pluck whose
strings are all muted becomes a rest, so the timing never changes.
"""

import random

ALL = [0, 1, 2, 3, 4, 5]
R, R2 = "R", "R2"

# Standard open shapes, low E to high e; x = string not played.
CHORDS = {
    "C": "x32010", "G": "320003", "D": "xx0232", "A": "x02220", "E": "022100",
    "Am": "x02210", "Em": "022000", "Dm": "xx0231", "F": "133211", "Bm": "x24432",
    "A7": "x02020", "B7": "x21202", "C7": "x32310", "D7": "xx0212", "E7": "020100",
    "G7": "320001", "Fmaj7": "xx3210", "Cadd9": "x32033", "Asus2": "x02200", "Dsus4": "xx0233",
}


def chord_strings(chord):
    """Strings the chord plays, low to high; every string when no chord is set."""
    return [i for i, c in enumerate(CHORDS[chord]) if c != "x"] if chord else ALL


def _voice(strings, allowed):
    root = allowed[0]
    alt = 2 if root == 0 else root + 1  # 6th-string roots alternate with the D string
    out = []
    for s in strings:
        s = root if s == R else alt if s == R2 else s
        if s in allowed and s not in out:
            out.append(s)
    return out


TREBLE = [2, 3, 4, 5]
FRAME_MS = 20          # sketch sends one servo frame every 20 ms, so times are multiples of this
STRUM_GAP_MS = 20      # time between strings within one strum
MAX_CHUNK = 200        # chars per Bridge message; the RPC buffer is 256 bytes incl. overhead


def p(strings, beats):
    return ("p", strings, beats)


def d(strings, beats):
    return ("d", strings, beats)


def u(strings, beats):
    return ("u", strings, beats)


def r(beats):
    return ("r", [], beats)


BAR_BEATS = 4  # every pattern is one bar of 4/4, so switching and the knob land on bar lines

PATTERNS = {
    "Strum": [d(ALL, 1), u(ALL, 1)] * 2,
    "Down-up eighths": [d(ALL, .5), u(ALL, .5)] * 4,
    "Folk (D DU UDU)": [d(ALL, 1), d(ALL, .5), u(ALL, 1), u(ALL, .5), d(ALL, .5), u(ALL, .5)],
    # Vance Joy's Riptide: the island strum (D, DU, UDU) over its chords, see PROGRESSIONS
    "Riptide": [d(ALL, 1), d(ALL, .5), u(ALL, 1), u(ALL, .5), d(ALL, .5), u(ALL, .5)],
    "Travis picking": [p([R, 5], .5), p([3], .5), p([R2], .5), p([4], .5),
                       p([R], .5), p([3], .5), p([R2], .5), p([4], .5)],
    "Arpeggio up": [p([s], 1 / 3) for s in ALL] * 2,  # triplets: two runs per bar
    "Arpeggio down": [p([s], 1 / 3) for s in reversed(ALL)] * 2,
    "Arpeggio up-down": [p([s], .5) for s in ALL + [4, 3]],
    "Boom-chick": [p([R], 1), d(TREBLE, 1), p([R2], 1), d(TREBLE, 1)],
    "Fingerstyle p-i-m-a": [p([R], .5), p([3], .5), p([4], .5), p([5], .5),
                            p([R2], .5), p([3], .5), p([4], .5), p([5], .5)],
    "Pinch pattern": [p([R, 5], 1), p([3], .5), p([4], .5), p([R2, 5], 1), p([3], .5), p([4], .5)],
    "Reggae skank": [r(1), u([3, 4, 5], 1), r(1), u([3, 4, 5], 1)],
    "Rock eighths (bass + chop)": [p([R], .5), d([3, 4, 5], .5)] * 4,
    # 32nd-note cross-picking on all six strings: bass walks up under B/e, ~27 plucks a second
    # at 200 BPM. Each string gets 4+ steps (160+ ms) between its own plucks, which is what an
    # SG90 needs to swing back past the string. Strings the chord mutes become rests.
    "Super-human (32nds)": [p([s], 1 / 8) for s in [0, 4, 1, 5, 2, 4, 3, 5]] * 4,
}

RANDOM = "Random"  # a new made-up bar every bar

# Patterns that come with their song's chords, one per bar, used while no chord is chosen.
PROGRESSIONS = {"Riptide": ["Am", "G", "C", "C"]}


MAX_SONG_BARS = 64


def bar_chord(name, chord, bar_no, song=None):
    """The chord for bar `bar_no`: the chosen one, else the loaded song's, else the pattern's own."""
    if chord:
        return chord
    prog = song or PROGRESSIONS.get(name)
    return prog[bar_no % len(prog)] if prog else None


def parse_song(text):
    """"Am, G, C, C" -> (["Am", "G", "C", "C"], None), one chord per bar; ([], None) for an
    empty string; (None, error) if a chord isn't in CHORDS or the song is too long."""
    names = [c.strip() for c in (text or "").split(",") if c.strip()]
    unknown = [c for c in names if c not in CHORDS]
    if unknown:
        return None, "unknown chord: " + ", ".join(unknown)
    if len(names) > MAX_SONG_BARS:
        return None, f"too long: {MAX_SONG_BARS} bars at most"
    return names, None


def random_bar(rng=random):
    """One 4/4 bar of random plucks and strums, starting with the bass on beat one."""
    events, left = [p([R], .5)], BAR_BEATS - .5
    while left > 0:
        beats = min(left, rng.choice([.25, .5, .5, 1]))
        if beats >= .5 and rng.random() < .3:  # strums need >= half a beat to ripple across
            events.append(rng.choice([d, u])(rng.choice([ALL, TREBLE]), beats))
        else:
            events.append(p(rng.choice([[R], [R2], [R, 5], [2], [3], [4], [5]]), beats))
        left -= beats
    return events


def next_pattern(name, step=1):
    """The pattern `step` places after `name` (-1 = before), wrapping round; for the knob button."""
    names = list(PATTERNS) + [RANDOM]
    return names[(names.index(name) + step) % len(names)]


def bar(name, rng=random):
    """The events for one bar of the named pattern."""
    return random_bar(rng) if name == RANDOM else PATTERNS[name]


def _frames(ms):
    return max(FRAME_MS, round(ms / FRAME_MS) * FRAME_MS)


def to_steps(pattern, bpm, chord=None):
    """Pattern -> list of (string_mask, ms) for the chord's strings. A mask of 0 is a rest."""
    beat_ms = 60000 / bpm
    allowed = chord_strings(chord)
    steps = []
    for kind, strings, beats in pattern:
        strings = _voice(strings, allowed)
        total = beat_ms * beats
        if kind in ("d", "u") and len(strings) > 1:
            order = strings if kind == "d" else list(reversed(strings))
            for s in order[:-1]:
                steps.append((1 << s, STRUM_GAP_MS))
            steps.append((1 << order[-1], _frames(total - STRUM_GAP_MS * (len(order) - 1))))
        else:
            mask = 0
            for s in strings:
                mask |= 1 << s
            steps.append((mask, _frames(total)))
    return steps


def to_chunks(steps):
    """Steps -> "mask:ms,mask:ms" strings, each short enough for one Bridge message."""
    chunks, cur = [], ""
    for mask, ms in steps:
        tok = f"{mask}:{ms}"
        if cur and len(cur) + 1 + len(tok) > MAX_CHUNK:
            chunks.append(cur)
            cur = ""
        cur = f"{cur},{tok}" if cur else tok
    if cur:
        chunks.append(cur)
    return chunks


def chunk_ms(chunk):
    return sum(int(t.split(":")[1]) for t in chunk.split(","))


# --- Bars for the MCU sequencer (sketch/sequencer.h) ---
# One bar is sent as "96;0:127,24:63": the bar length in ticks, then tick:mask events.
# 1 tick = 1/24 beat (8ths, 16ths, triplets and 32nds all land on whole ticks).
# mask = 6 string bits (bit 0 = low E) | KIND_DOWN / KIND_UP for a strum, nothing for a pluck.

TICKS_PER_BEAT = 24
SUB_PER_TICK = 125  # the sequencer counts 1/125 ticks, so one 20 ms frame = exactly `bpm` of them
KIND_DOWN, KIND_UP = 0x40, 0x80
MAX_BAR_CHARS = MAX_CHUNK  # one Bridge message


def encode_bar(pattern, chord=None):
    """Pattern events -> the sequencer's bar string, voiced for `chord` exactly as to_steps does:
    R/R2 become the chord's bass strings, muted strings are dropped, an all-muted event is a rest."""
    allowed = chord_strings(chord)
    beats, parts = 0.0, []
    for kind, strings, length in pattern:
        tick = round(beats * TICKS_PER_BEAT)
        assert abs(beats * TICKS_PER_BEAT - tick) < 1e-6, f"event at {beats} beats is between ticks"
        strings = _voice(strings, allowed)
        if strings:
            mask = sum(1 << s for s in strings)
            if kind in ("d", "u") and len(strings) > 1:
                mask |= KIND_DOWN if kind == "d" else KIND_UP
            parts.append(f"{tick}:{mask}")
        beats += length
    return f"{round(BAR_BEATS * TICKS_PER_BEAT)};" + ",".join(parts)


def parse_bar(text):
    """"96;0:127,24:63" -> (96, [(0, 127), (24, 63)])."""
    length, _, events = text.partition(";")
    return int(length), [tuple(int(x) for x in e.split(":")) for e in events.split(",") if e]


def _fire(mask, ripple):
    strings, kind = mask & 63, mask & (KIND_DOWN | KIND_UP)
    order = [s for s in range(6) if strings >> s & 1]
    if kind == KIND_UP:
        order.reverse()
    if not kind or len(order) <= 1:
        return strings
    for k, s in enumerate(order[1:], 1):
        ripple[k - 1] |= 1 << s
    return 1 << order[0]


def simulate(text, bpm, frames):
    """What sequencer.h plays: [[frame, strings plucked], ...] for `frames` 20 ms frames of the
    bar looping at a steady `bpm`. Kept line for line with Sequencer::step()."""
    length, events = parse_bar(text)
    bar_len, pos, idx, ripple, out = length * SUB_PER_TICK, 0, 0, [0] * 6, []
    for frame in range(frames):
        m = ripple.pop(0)
        ripple.append(0)
        while True:
            while idx < len(events) and 2 * events[idx][0] * SUB_PER_TICK < 2 * pos + bpm:
                m |= _fire(events[idx][1], ripple)
                idx += 1
            if 2 * pos + bpm <= 2 * bar_len:
                break
            pos -= bar_len  # this frame is nearest the bar line: the next bar starts here
            idx = 0
        pos += bpm
        if m:
            out.append([frame, m])
    return out
