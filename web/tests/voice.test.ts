// voice.js / eleven.js / coach.js (Ray's voice plugin, verbatim): what speech-to-text hands us ->
// the command the page runs. Uses the real chord and pattern names from strummer/music.py, so a
// renamed pattern that voice can no longer reach fails here. Ported from tests/voice_test.mjs:
// every assertion is unchanged, grouped into one vitest test per section.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { coachPrompt, coachTools } from '../src/plugins/voice/coach.js';
import { SpeechGate } from '../src/plugins/voice/eleven.js';
import { chordHelp, keyterms, normalise, parseCommand, patternWords, SONGS, spokenChord, stripWake } from '../src/plugins/voice/voice.js';
import { chords, patterns } from './music';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = (text: string): any => parseCommand(text, { patterns, chords });

test('every pattern can be asked for by its own name, with or without "play"', () => {
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
});

test('stop wins over anything else in the sentence', () => {
  // stop wins over anything else in the sentence
  for (const t of ['Stop.', 'stop playing', 'okay stop the strum', 'pause', 'Stop! (guitar strumming)']) assert.deepEqual(cmd(t), { action: 'stop' }, t);
});

test('tempo: digits, words, relative', () => {
  // tempo: digits, words, relative
  assert.deepEqual(cmd('tempo 90'), { action: 'tempo', bpm: 90 });
  assert.deepEqual(cmd('Set the tempo to ninety.'), { action: 'tempo', bpm: 90 });
  assert.deepEqual(cmd('one hundred and twenty beats per minute'), { action: 'tempo', bpm: 120 });
  assert.deepEqual(cmd('speed one twenty'), { action: 'tempo', bpm: 120 });
  assert.deepEqual(cmd('faster'), { action: 'tempo_delta', delta: 10 });
  assert.deepEqual(cmd('a lot slower'), { action: 'tempo_delta', delta: -20 });
  assert.deepEqual(cmd('slow down'), { action: 'tempo_delta', delta: -10 });
  assert.equal(cmd('tempo 500'), null);  // out of range: not a tempo
});

test('chords: spoken, written, with the article "a" in the way', () => {
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
});

test('coach questions', () => {
  // coach questions
  assert.deepEqual(cmd('How do I play an F?'), { action: 'explain', chord: 'F' });
  assert.deepEqual(cmd('how do you play a B minor'), { action: 'explain', chord: 'Bm' });
  assert.deepEqual(cmd("What's D seven?"), { action: 'explain', chord: 'D7' });
  assert.deepEqual(cmd('show me a minor'), { action: 'explain', chord: 'Am' });
  assert.deepEqual(cmd('What chord am I playing?'), { action: 'what' });
  assert.deepEqual(cmd('what am I playing'), { action: 'what' });
  assert.deepEqual(cmd('help'), { action: 'help' });
});

test('songs: named progressions and spoken chord lists', () => {
  // songs: named progressions and spoken chord lists
  assert.deepEqual(cmd('twelve bar blues').chords.length, 12);
  assert.deepEqual(cmd('play the four chord song').chords, ['G', 'D', 'Em', 'C']);
  assert.deepEqual(cmd('Chords: A minor, G, C, C.'), { action: 'song', chords: ['Am', 'G', 'C', 'C'] });
  assert.deepEqual(cmd('play the chords G, D, E minor and C'), { action: 'song', chords: ['G', 'D', 'Em', 'C'] });
  assert.deepEqual(cmd('progression am f c g'), { action: 'song', chords: ['Am', 'F', 'C', 'G'] });
  assert.deepEqual(cmd('chords gee dee see'), { action: 'song', chords: ['G', 'D', 'C'] });
  assert.deepEqual(cmd('clear the song'), { action: 'song', chords: [] });
  for (const s of SONGS) assert.ok(s.chords.every(c => chords.includes(c)), s.name);
});

test('navigation', () => {
  // navigation
  assert.deepEqual(cmd('next'), { action: 'next' });
  assert.deepEqual(cmd('next pattern'), { action: 'next' });
  assert.deepEqual(cmd('go back'), { action: 'prev' });
});

test('chatter is not a command', () => {
  // chatter is not a command
  for (const t of ['', 'so anyway I was thinking about lunch', 'that sounds really nice', '(guitar strumming)']) assert.equal(cmd(t), null, t);
});

test('wake word for hands-free', () => {
  // wake word for hands-free
  assert.equal(stripWake('Guitar, play Travis picking'), 'play travis picking');
  assert.equal(stripWake('hey guitar stop'), 'stop');
  assert.equal(stripWake('Guitar.'), '');
  assert.equal(stripWake('play Travis picking'), null);
  assert.equal(stripWake('I was telling him about my guitar the other day'), null);  // not at the start
});

test('speaking chords', () => {
  // speaking chords
  assert.equal(spokenChord('Am'), 'A minor');
  assert.equal(spokenChord('G'), 'G major');
  assert.equal(spokenChord('Fmaj7'), 'F major seven');
  assert.equal(spokenChord(''), 'all strings');
  for (const c of chords) assert.ok(!/undefined/.test(spokenChord(c)) && spokenChord(c).length > 2, c);
  assert.equal(chordHelp('D', 'xx0232'), 'D major. Low E string: not played. A string: not played. D string: open. G string: fret 2. B string: fret 3. High E string: fret 2.');
  // what the page says back must parse to the same chord (the coach and the player share a vocabulary)
  for (const c of chords) assert.deepEqual(cmd(`chord ${spokenChord(c)}`), { action: 'chord', chord: c }, c);
});

test('keyterms fit the speech-to-text limits (50 chars, 5 words, none of < > { } [ ] \)', () => {
  // keyterms fit the speech-to-text limits (50 chars, 5 words, none of < > { } [ ] \)
  const terms = keyterms(patterns, chords);
  assert.ok(terms.length > 20 && terms.length <= 1000);
  for (const k of terms) assert.ok(k.length <= 50 && k.split(' ').length <= 5 && !/[<>{}[\]\\]/.test(k), k);

  assert.equal(normalise('Set TEMPO to one hundred and five!'), 'set tempo to 105');
});

test('hands-free gate: a steady loud room never opens it; a voice over the room does, then it closes', () => {
  // hands-free gate: a steady loud room never opens it; a voice over the room does, then it closes
  const gate = new SpeechGate();
  let events: (string | null)[] = [];
  for (let i = 0; i < 200; i++) events.push(gate.tick(0.08 + 0.01 * Math.sin(i), 3));  // constant strumming / chatter
  assert.ok(events.filter(e => e === 'start').length <= 1, 'steady noise must not keep triggering');
  while (gate.open) gate.tick(0.08, 3);
  for (let i = 0; i < 40; i++) gate.tick(0.08, 3);
  events = [];
  for (let i = 0; i < 20; i++) events.push(gate.tick(0.5, 3));   // someone speaks up
  for (let i = 0; i < 40; i++) events.push(gate.tick(0.08, 3));  // and stops
  assert.deepEqual(events.filter(Boolean), ['start', 'end']);
});

test('coach: every tool has a description and a parameter schema, and the prompt names every chord', () => {
  // coach: every tool has a description and a parameter schema, and the prompt names every chord
  const tools = coachTools(patterns, chords);
  assert.deepEqual(tools.map(t => t.name), ['play_pattern', 'stop_playing', 'set_tempo', 'set_chord', 'load_song', 'get_state']);
  for (const t of tools) assert.ok(t.description && t.parameters.type === 'object' && Array.isArray(t.parameters.required), t.name);
  for (const c of chords) assert.ok(coachPrompt(patterns, chords).includes(c), c);
});
