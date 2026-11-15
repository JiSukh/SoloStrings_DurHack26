// lesson.js: the songs, the random warm-up, bar timing and the green/red verdicts; and the
// "teach me ..." voice commands that start a lesson. Uses the real chord names from music.py.
import { BASIC, LESSONS, MAX_LESSON_BARS, PASS_SCORE, randomChords, gradeBar, Lesson } from '../servo-strummer/assets/lesson.js';
import { matchChord, template } from '../servo-strummer/assets/listen.js';
import { parseCommand, normalise } from '../servo-strummer/assets/voice.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../servo-strummer/python/strummer/music.py', import.meta.url), 'utf8');
const CHORDS = Object.fromEntries([...src.matchAll(/"([A-G][a-z0-9]*)": "([x0-9]{6})"/g)].map(m => [m[1], m[2]]));
const chords = Object.keys(CHORDS);
const patterns = [...src.matchAll(/^    "([^"]+)": \[/gm)].map(m => m[1]).concat('Random');
const maxBars = Number(/MAX_SONG_BARS = (\d+)/.exec(src)[1]);

// every song and warm-up chord is one the strummer knows, and fits the board's song length
assert.ok(BASIC.every(c => chords.includes(c)), 'BASIC');
assert.ok(MAX_LESSON_BARS <= maxBars);
for (const l of LESSONS) {
  assert.ok(l.chords.every(c => chords.includes(c)), l.name);
  assert.ok(l.chords.length >= 4 && l.chords.length <= MAX_LESSON_BARS, l.name);
  assert.ok(l.match.test(normalise(l.name)), `${l.name} is not matched by its own name`);
  assert.ok(!l.pattern || patterns.includes(l.pattern), `${l.name}: no such pattern ${l.pattern}`);
}
// Riptide: A minor one bar, G one bar, C two bars, repeated
const riptide = LESSONS.find(l => l.name === 'Riptide');
assert.equal(riptide.chords.length % 4, 0);
riptide.chords.forEach((c, i) => assert.equal(c, ['Am', 'G', 'C', 'C'][i % 4], `Riptide bar ${i + 1}`));
assert.ok(riptide.chords.length >= 16, 'Riptide goes round more than twice');

// random warm-up: the right length, only from the pool, never the same chord twice running
for (let run = 0; run < 50; run++) {
  const r = randomChords(8);
  assert.equal(r.length, 8);
  assert.ok(r.every(c => BASIC.includes(c)));
  assert.ok(r.every((c, i) => c !== r[i - 1]), r.join(' '));
}
let n = 0;
assert.deepEqual(randomChords(4, ['G', 'C'], () => (n++ % 2) / 2), ['G', 'C', 'G', 'C']);

// one bar's verdict: one moment at 80% or more on the ear meter is enough; silence, or never
// reaching it all bar, is a miss.
assert.equal(PASS_SCORE, 0.8);
assert.equal(gradeBar([0.2, 0.3, PASS_SCORE, 0.1]), 'hit', 'one good moment');
assert.equal(gradeBar([null, null, 0.9]), 'hit');
assert.equal(gradeBar([0.1, 0.3, PASS_SCORE - 0.01]), 'miss', 'never near the chord');
assert.equal(gradeBar([null, null]), 'miss', 'silence');
assert.equal(gradeBar([]), 'miss', 'nothing heard at all');
assert.equal(gradeBar([0.79, 0.6, 0.5]), 'miss', '79% is not enough');
assert.equal(gradeBar([0.6], 0.5), 'hit', 'the pass mark can be changed');
// the score the page feeds in: the sound against the one wanted chord. The chord itself, even
// with a couple of strings missed, passes; a different chord doesn't.
const likeness = (sound, want) => matchChord(sound, { [want]: CHORDS[want] }).score;
for (const c of chords) assert.ok(likeness(template(CHORDS[c]), c) > 0.99, c);
assert.ok(likeness(template(CHORDS.G, [1, 2, 3, 4]), 'G') >= PASS_SCORE, 'G with the outer strings missed');
assert.ok(likeness(template(CHORDS.Am, [2, 3, 4, 5]), 'Am') >= PASS_SCORE, 'A minor on the top four strings');
assert.ok(likeness(template(CHORDS.D), 'G') < PASS_SCORE, 'D is not G');
assert.ok(likeness(template(CHORDS.E), 'C') < PASS_SCORE, 'E is not C');

// a lesson: bars at the planned times until the robot reports its own
const l = new Lesson({ title: 't', chords: ['G', 'C', 'D'], barMs: 1000, startAt: 5000 });
assert.deepEqual([0, 1, 2].map(i => l.barStart(i)), [5000, 6000, 7000]);
assert.equal(l.endAt, 8000);
assert.equal(l.barAt(4999), -1);
assert.equal(l.barAt(5000), 0);
assert.equal(l.barAt(7999), 2);
assert.equal(l.barAt(8000), -1);
l.onBar(0, 5200, 2000);  // started late, and the knob halved the tempo
assert.deepEqual([0, 1, 2].map(i => l.barStart(i)), [5200, 7200, 9200]);
l.onBar(1, 7300, 2000);
assert.equal(l.barStart(2), 9300);
l.onBar(7, 1, 1);  // a bar past the end changes nothing
assert.equal(l.endAt, 11300);

// hearing: each reading goes to the bar being played; verdicts come at the bar's end
assert.equal(l.chordAt(5100), null, 'before the first bar');
assert.equal(l.chordAt(5300), 'G');
assert.equal(l.chordAt(7400), 'C');
l.hear(5250, 0.2);
assert.equal(l.look(0), null);
l.hear(5600, 0.85);
assert.equal(l.look(0), 'hit', 'already won before the bar is over');
assert.equal(l.grades[0], null);
for (const t of [7700, 8000, 8400]) l.hear(t, t === 8000 ? null : 0.3);  // bar 1: never near its chord
assert.equal(l.look(1), null);
l.settle(9300);
assert.deepEqual(l.grades, ['hit', 'miss', null]);
l.hear(7800, 0.9);  // too late: bar 1 has its verdict
assert.equal(l.grades[1], 'miss');
l.finish(11300);
assert.deepEqual(l.grades, ['hit', 'miss', 'miss']);
assert.deepEqual(l.score(), { hits: 1, total: 3 });
assert.equal(l.endedAt, 11300);

// "teach me ...": a carried song by name, any other song as a query (the coach says it doesn't know it), the warm-up, and chords still explained
const cmd = text => parseCommand(text, { patterns, chords, lessons: LESSONS });
assert.deepEqual(cmd('Teach me Riptide.'), { action: 'teach', song: 'Riptide' });
assert.deepEqual(cmd('teach me this song, Riptide'), { action: 'teach', song: 'Riptide' });
assert.deepEqual(cmd("Teach me Knockin' on Heaven's Door"), { action: 'teach', song: 'Knockin’ on Heaven’s Door' });
assert.deepEqual(cmd('teach me knocking on heavens door'), { action: 'teach', song: 'Knockin’ on Heaven’s Door' });
assert.deepEqual(cmd('I want to learn stand by me'), { action: 'teach', song: 'Stand by Me' });
assert.deepEqual(cmd('teach me the twelve bar blues'), { action: 'teach', song: 'Twelve bar blues' });
assert.deepEqual(cmd('Teach me the song Wonderwall'), { action: 'teach', query: 'wonderwall' });
assert.deepEqual(cmd('teach me how to play let it be'), { action: 'teach', query: 'let it be' });
assert.deepEqual(cmd('learn hotel california on guitar'), { action: 'teach', query: 'hotel california' });
assert.deepEqual(cmd('teach me random chords'), { action: 'teach', random: true });
assert.deepEqual(cmd("let's practise some chords"), { action: 'teach', random: true });
assert.deepEqual(cmd('start a lesson'), { action: 'teach', random: true });
assert.deepEqual(cmd('teach me a song'), { action: 'teach', song: LESSONS[0].name });
assert.deepEqual(cmd('teach me a minor'), { action: 'explain', chord: 'Am' });
assert.deepEqual(cmd('teach me how to play F'), { action: 'explain', chord: 'F' });
assert.deepEqual(cmd('stop the lesson'), { action: 'stop' });
assert.deepEqual(cmd('twelve bar blues').action, 'song', 'without "teach" it still just loads the song');

console.log('lesson_test: ok');
