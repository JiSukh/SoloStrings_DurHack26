// grade.ts with synthetic mic readings: a 2000 ms bar starting at t=1000, a reading every 100 ms.
import { expect, test } from 'vitest';
import { gradeBar, suggestTempo, summarise, type Bar, type Reading } from '../src/lib/practice/grade';

const START = 1000, LEN = 2000;
// readings across the whole bar: chordAt(fraction of the bar) -> chord or null
function bar(chord: string, chordAt: (f: number) => string | null): Bar {
  const readings: Reading[] = [];
  for (let t = START; t < START + LEN; t += 100) readings.push({ t, chord: chordAt((t - START) / LEN) });
  return { chord, start: START, length: LEN, readings };
}

test('hit: the right chord for at least half the graded readings', () => {
  expect(gradeBar(bar('Am', () => 'Am'))).toBe('hit');
  // wrong during the change time (first quarter) doesn't count
  expect(gradeBar(bar('Am', f => (f < 0.25 ? 'G' : 'Am')))).toBe('hit');
  // half right after the change time is still a hit
  expect(gradeBar(bar('Am', f => (f < 0.625 ? 'Am' : 'C')))).toBe('hit');
  // unsure readings (null) don't count against it
  expect(gradeBar(bar('Am', f => (f < 0.8 ? null : 'Am')))).toBe('hit');
});

test('late: right only in the second half', () => {
  // from 70 %: 6 of the 15 graded readings (not a hit), but 6 of the 10 in the second half
  expect(gradeBar(bar('Am', f => (f < 0.7 ? 'G' : 'Am')))).toBe('late');
});

test('miss: wrong, or right too little', () => {
  expect(gradeBar(bar('Am', () => 'G'))).toBe('miss');
  expect(gradeBar(bar('Am', f => (f > 0.9 ? 'Am' : 'C')))).toBe('miss');  // a flicker at the end
});

test('silent: no confident reading after the change time', () => {
  expect(gradeBar(bar('Am', () => null))).toBe('silent');
  expect(gradeBar(bar('Am', f => (f < 0.2 ? 'Am' : null)))).toBe('silent');
  expect(gradeBar({ chord: 'Am', start: 0, length: 2000, readings: [] })).toBe('silent');
});

test('summary: score, per chord, per change (same numbers as strummer/store.py)', () => {
  const s = summarise([['Am', 'hit'], ['G', 'late'], ['C', 'miss'], ['C', 'hit'], ['Am', 'silent']]);
  expect(s.score).toBe(50);
  expect(s.chords.C).toEqual({ accuracy: 50, bars: 2 });
  expect(s.changes).toEqual({ 'Am→G': { accuracy: 50, bars: 1 }, 'G→C': { accuracy: 0, bars: 1 }, 'C→Am': { accuracy: 0, bars: 1 } });
  expect(summarise([['Am', 'hit'], ['G', 'hit'], ['C', 'late'], ['C', 'miss']]).score).toBe(63);  // 62.5 rounds up on both sides
  expect(summarise([]).score).toBe(0);
});

test('speed trainer', () => {
  expect(suggestTempo(90, 100)).toBe(105);
  expect(suggestTempo(75, 100)).toBe(100);
  expect(suggestTempo(59, 100)).toBe(95);
  expect(suggestTempo(100, 200)).toBe(200);
  expect(suggestTempo(0, 30)).toBe(30);
});
