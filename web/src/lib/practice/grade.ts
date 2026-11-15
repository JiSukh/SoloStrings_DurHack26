// Grading a practice run from microphone readings. Pure functions (no browser, no board), so
// the rules are tested with synthetic readings (web/tests/grade.test.ts). The board stores the
// same results and works out the same score (strummer/store.py: summarise).

export type Grade = 'hit' | 'late' | 'miss' | 'silent';

// One mic reading (matchChord every 100 ms): when it arrived (performance.now()), and the chord
// if it was confident, else null (too quiet, or not sure).
export interface Reading { t: number; chord: string | null }

// A bar of the run: the chord it expects, when it started here (its push arrived) and how long it is.
export interface Bar { chord: string; start: number; length: number; readings: Reading[] }

export const CHANGE_TIME = 0.25;  // the first quarter of each bar is for moving the hand: not graded
export const HIT_SHARE = 0.5;     // at least half the confident readings must be the right chord

const share = (rs: Reading[], chord: string) => (rs.length ? rs.filter(r => r.chord === chord).length / rs.length : 0);

// hit: right chord for >= 50 % of the confident readings after the change time;
// late: only right in the second half of the bar; miss: otherwise; silent: no confident reading.
export function gradeBar(bar: Bar): Grade {
  const from = bar.start + CHANGE_TIME * bar.length, mid = bar.start + bar.length / 2;
  const counted = bar.readings.filter(r => r.chord && r.t >= from);
  if (!counted.length) return 'silent';
  if (share(counted, bar.chord) >= HIT_SHARE) return 'hit';
  if (share(counted.filter(r => r.t >= mid), bar.chord) >= HIT_SHARE) return 'late';
  return 'miss';
}

export const CREDIT: Record<Grade, number> = { hit: 1, late: 0.5, miss: 0, silent: 0 };

export interface Accuracy { accuracy: number; bars: number }
export interface Summary { score: number; chords: Record<string, Accuracy>; changes: Record<string, Accuracy> }

const pct = (points: number, bars: number) => (bars ? Math.round((100 * points) / bars) : 0);

// [chord, grade] per bar -> score (0-100: hit 1, late 1/2) and accuracy per chord and per change
// ("Am→G" is graded by the bar after the change).
export function summarise(results: [string, Grade][]): Summary {
  const chords: Record<string, [number, number]> = {}, changes: Record<string, [number, number]> = {};
  const add = (m: Record<string, [number, number]>, k: string, g: Grade) => {
    const e = (m[k] ||= [0, 0]);
    e[0] += CREDIT[g];
    e[1] += 1;
  };
  results.forEach(([c, g], i) => {
    add(chords, c, g);
    if (i && results[i - 1][0] !== c) add(changes, `${results[i - 1][0]}→${c}`, g);
  });
  const done = (m: Record<string, [number, number]>) =>
    Object.fromEntries(Object.entries(m).map(([k, [p, n]]) => [k, { accuracy: pct(p, n), bars: n }]));
  return { score: pct(results.reduce((s, [, g]) => s + CREDIT[g], 0), results.length), chords: done(chords), changes: done(changes) };
}

// Speed trainer: >= 90 % suggests 5 BPM faster, < 60 % 5 BPM slower, else stay (within 30-200).
export function suggestTempo(score: number, bpm: number): number {
  const next = score >= 90 ? bpm + 5 : score < 60 ? bpm - 5 : bpm;
  return Math.min(200, Math.max(30, next));
}
