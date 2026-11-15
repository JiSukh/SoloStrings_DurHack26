// lesson.js: the songs, the random warm-up, bar timing and the green/red verdicts; and the
// "teach me ..." voice commands that start a lesson. Uses the real chord names from music.py.
import { BASIC, LESSONS, OPEN, MAX_LESSON_BARS, randomChords, cleanProgression, earShapes, gradeBar, Lesson } from '../servo-strummer/assets/lesson.js';
import { parseCommand, normalise } from '../servo-strummer/assets/voice.js';
import { songPrompt } from '../servo-strummer/assets/gemini.js';
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
}

// random warm-up: the right length, only from the pool, never the same chord twice running
for (let run = 0; run < 50; run++) {
  const r = randomChords(8);
  assert.equal(r.length, 8);
  assert.ok(r.every(c => BASIC.includes(c)));
  assert.ok(r.every((c, i) => c !== r[i - 1]), r.join(' '));
}
let n = 0;
assert.deepEqual(randomChords(4, ['G', 'C'], () => (n++ % 2) / 2), ['G', 'C', 'G', 'C']);

// a progression from outside: unknown chords dropped, nonsense refused
assert.deepEqual(cleanProgression(['em', ' G ', 'D', 'A7'], chords), ['Em', 'G', 'D', 'A7']);
assert.deepEqual(cleanProgression(['Em', 'G', 'D', 'C', 'F#m7b5'], chords), ['Em', 'G', 'D', 'C']);
assert.equal(cleanProgression(['Em', 'F#', 'Bb', 'G', 'C#'], chords), null, 'mostly unplayable');
assert.equal(cleanProgression(['G', 'G', 'G', 'G'], chords), null, 'one chord is not a song');
assert.equal(cleanProgression(['G', 'C'], chords), null, 'too short');
assert.equal(cleanProgression('G C D', chords), null);
assert.equal(cleanProgression(new Array(100).fill(0).map((_, i) => (i % 2 ? 'G' : 'C')), chords).length, MAX_LESSON_BARS);

// what the ear chooses between: the lesson's chords, the basic ones, and the open strings
const shapes = earShapes(['A7', 'D7'], CHORDS);
assert.equal(shapes[OPEN], '000000');
assert.equal(shapes.A7, CHORDS.A7);
assert.equal(shapes.G, CHORDS.G);
assert.equal(shapes.Cadd9, undefined, 'look-alikes outside the lesson are left out');

// one bar's verdict
assert.equal(gradeBar(['G', 'G', null, 'G'], 'G'), 'hit');
assert.equal(gradeBar(['C', 'G', 'G', null], 'G'), 'hit', 'a slow change still counts');
assert.equal(gradeBar(['C', 'C', 'C', 'G', 'G'], 'G'), 'miss', 'mostly the wrong chord');
assert.equal(gradeBar(['G'], 'G'), 'miss', 'one reading is not enough');
assert.equal(gradeBar([null, null], 'G'), 'miss', 'silence');
assert.equal(gradeBar([OPEN, OPEN, OPEN], 'G'), 'miss', 'open strings');

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

// hearing: the first part of a bar is the change and doesn't count; verdicts come at the bar's end
l.hear(5250, 'C');  // still settling
for (const t of [5600, 6000, 6400]) l.hear(t, 'G');
assert.equal(l.look(0), 'hit', 'already won before the bar is over');
assert.equal(l.grades[0], null);
for (const t of [7700, 8000, 8400]) l.hear(t, 'G');  // bar 1 wants C
assert.equal(l.look(1), null);
l.settle(9300);
assert.deepEqual(l.grades, ['hit', 'miss', null]);
l.hear(7800, 'C');  // too late: bar 1 has its verdict
assert.equal(l.grades[1], 'miss');
l.finish(11300);
assert.deepEqual(l.grades, ['hit', 'miss', 'miss']);
assert.deepEqual(l.score(), { hits: 1, total: 3 });
assert.equal(l.endedAt, 11300);

// "teach me ...": a carried song by name, any other song as a query, the warm-up, and chords still explained
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

// the Gemini prompt names the song and the only chords allowed
const prompt = songPrompt('Wonderwall', chords);
assert.ok(prompt.includes('"Wonderwall"') && chords.every(c => prompt.includes(c)));

console.log('lesson_test: ok');
