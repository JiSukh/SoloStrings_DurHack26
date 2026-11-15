// voice.js: what speech-to-text hands us -> the command the page runs. Uses the real chord
// and pattern names from patterns.py, so a renamed pattern that voice can no longer reach
// fails here.
import { parseCommand, stripWake, spokenChord, chordHelp, keyterms, normalise, patternWords, SONGS } from '../servo-strummer/assets/voice.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../servo-strummer/python/strummer/music.py', import.meta.url), 'utf8');
const CHORDS = Object.fromEntries([...src.matchAll(/"([A-G][a-z0-9]*)": "([x0-9]{6})"/g)].map(m => [m[1], m[2]]));
const patterns = [...src.matchAll(/^    "([^"]+)": \[/gm)].map(m => m[1]).concat('Random');
const chords = Object.keys(CHORDS);
assert.ok(chords.length >= 20 && patterns.length >= 14, 'could not read CHORDS / PATTERNS from strummer/music.py');
const cmd = text => parseCommand(text, { patterns, chords });

// every pattern can be asked for by its own name, with or without "play"
for (const p of patterns) {
  const said = patternWords(p).join(' ');
  assert.deepEqual(cmd(`play ${said}`), { action: 'play', pattern: p }, p);
  assert.deepEqual(cmd(said), { action: 'play', pattern: p }, p);
}
assert.equal(cmd('Play Travis picking.').pattern, 'Travis picking');
assert.equal(cmd('travis').pattern, 'Travis picking');
assert.equal(cmd('Play arpeggio up').pattern, 'Arpeggio up');
assert.equal(cmd('arpeggio up and down').pattern, 'Arpeggio up-down');
assert.equal(cmd('play the superhuman one').pattern, 'Super-human (32nds)');
assert.equal(cmd('boom chick please').pattern, 'Boom-chick');
assert.equal(cmd('rock eights').pattern, 'Rock eighths (bass + chop)');
assert.deepEqual(cmd('play reggae at 80'), { action: 'play', pattern: 'Reggae skank', bpm: 80 });
assert.deepEqual(cmd('Play.'), { action: 'play', pattern: null });
assert.deepEqual(cmd('start strumming'), { action: 'play', pattern: null });

// stop wins over anything else in the sentence
for (const t of ['Stop.', 'stop playing', 'okay stop the strum', 'pause', 'Stop! (guitar strumming)']) assert.deepEqual(cmd(t), { action: 'stop' }, t);

// tempo: digits, words, relative
assert.deepEqual(cmd('tempo 90'), { action: 'tempo', bpm: 90 });
assert.deepEqual(cmd('Set the tempo to ninety.'), { action: 'tempo', bpm: 90 });
assert.deepEqual(cmd('one hundred and twenty beats per minute'), { action: 'tempo', bpm: 120 });
assert.deepEqual(cmd('speed one twenty'), { action: 'tempo', bpm: 120 });
assert.deepEqual(cmd('faster'), { action: 'tempo_delta', delta: 10 });
assert.deepEqual(cmd('a lot slower'), { action: 'tempo_delta', delta: -20 });
assert.deepEqual(cmd('slow down'), { action: 'tempo_delta', delta: -10 });
assert.equal(cmd('tempo 500'), null);  // out of range: not a tempo

// chords: spoken, written, with the article "a" in the way
assert.deepEqual(cmd('chord A minor'), { action: 'chord', chord: 'Am' });
assert.deepEqual(cmd('set the chord to G'), { action: 'chord', chord: 'G' });
assert.deepEqual(cmd('play a G chord'), { action: 'chord', chord: 'G' });
assert.deepEqual(cmd('chord E seven'), { action: 'chord', chord: 'E7' });
assert.deepEqual(cmd('chord Fmaj7'), { action: 'chord', chord: 'Fmaj7' });
assert.deepEqual(cmd('chord F major seven'), { action: 'chord', chord: 'Fmaj7' });
assert.deepEqual(cmd('chord C add nine'), { action: 'chord', chord: 'Cadd9' });
assert.deepEqual(cmd('chord D sus four'), { action: 'chord', chord: 'Dsus4' });
assert.deepEqual(cmd('the chord is a'), { action: 'chord', chord: 'A' });
assert.deepEqual(cmd('all strings'), { action: 'chord', chord: '' });
assert.equal(cmd('chord F sharp'), null);  // not a shape the strummer has

// coach questions
assert.deepEqual(cmd('How do I play an F?'), { action: 'explain', chord: 'F' });
assert.deepEqual(cmd('how do you play a B minor'), { action: 'explain', chord: 'Bm' });
assert.deepEqual(cmd("What's D seven?"), { action: 'explain', chord: 'D7' });
assert.deepEqual(cmd('show me a minor'), { action: 'explain', chord: 'Am' });
assert.deepEqual(cmd('What chord am I playing?'), { action: 'what' });
assert.deepEqual(cmd('what am I playing'), { action: 'what' });
assert.deepEqual(cmd('help'), { action: 'help' });

// songs: named progressions and spoken chord lists
assert.deepEqual(cmd('twelve bar blues').chords.length, 12);
assert.deepEqual(cmd('play the four chord song').chords, ['G', 'D', 'Em', 'C']);
assert.deepEqual(cmd('Chords: A minor, G, C, C.'), { action: 'song', chords: ['Am', 'G', 'C', 'C'] });
assert.deepEqual(cmd('play the chords G, D, E minor and C'), { action: 'song', chords: ['G', 'D', 'Em', 'C'] });
assert.deepEqual(cmd('progression am f c g'), { action: 'song', chords: ['Am', 'F', 'C', 'G'] });
assert.deepEqual(cmd('chords gee dee see'), { action: 'song', chords: ['G', 'D', 'C'] });
assert.deepEqual(cmd('clear the song'), { action: 'song', chords: [] });
for (const s of SONGS) assert.ok(s.chords.every(c => chords.includes(c)), s.name);

// navigation
assert.deepEqual(cmd('next'), { action: 'next' });
assert.deepEqual(cmd('next pattern'), { action: 'next' });
assert.deepEqual(cmd('go back'), { action: 'prev' });

// chatter is not a command
for (const t of ['', 'so anyway I was thinking about lunch', 'that sounds really nice', '(guitar strumming)']) assert.equal(cmd(t), null, t);

// wake word for hands-free
assert.equal(stripWake('Guitar, play Travis picking'), 'play travis picking');
assert.equal(stripWake('hey guitar stop'), 'stop');
assert.equal(stripWake('Guitar.'), '');
assert.equal(stripWake('play Travis picking'), null);
assert.equal(stripWake('I was telling him about my guitar the other day'), null);  // not at the start

// speaking chords
assert.equal(spokenChord('Am'), 'A minor');
assert.equal(spokenChord('G'), 'G major');
assert.equal(spokenChord('Fmaj7'), 'F major seven');
assert.equal(spokenChord(''), 'all strings');
for (const c of chords) assert.ok(!/undefined/.test(spokenChord(c)) && spokenChord(c).length > 2, c);
assert.equal(chordHelp('D', 'xx0232'), 'D major. Low E string: not played. A string: not played. D string: open. G string: fret 2. B string: fret 3. High E string: fret 2.');
// what the page says back must parse to the same chord (the coach and the player share a vocabulary)
for (const c of chords) assert.deepEqual(cmd(`chord ${spokenChord(c)}`), { action: 'chord', chord: c }, c);

// keyterms fit the speech-to-text limits (50 chars, 5 words, none of < > { } [ ] \)
const terms = keyterms(patterns, chords);
assert.ok(terms.length > 20 && terms.length <= 1000);
for (const k of terms) assert.ok(k.length <= 50 && k.split(' ').length <= 5 && !/[<>{}[\]\\]/.test(k), k);

assert.equal(normalise('Set TEMPO to one hundred and five!'), 'set tempo to 105');

console.log('voice_test: ok');
