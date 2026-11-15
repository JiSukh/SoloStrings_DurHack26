// A whole practice run against a fake board and a fake microphone: count-in, the robot's bars
// arriving, readings graded into the bar current when they arrived, and the saved session.
import { get } from 'svelte/store';
import { beforeAll, expect, test, vi } from 'vitest';
import type { Reading } from '../src/lib/practice/grade';

const handlers: Record<string, (...a: unknown[]) => void> = {};
vi.mock('socket.io-client', () => ({ io: () => ({ on: (ev: string, fn: (...a: unknown[]) => void) => { handlers[ev] = fn; } }) }));

let feed: ((r: Reading) => void) | null = null;
vi.mock('../src/lib/practice/mic', () => ({
  listen: async (_chords: unknown, onReading: (r: Reading) => void) => { feed = onReading; return () => { feed = null; }; },
}));

const calls: string[] = [];
vi.stubGlobal('fetch', async (url: string, init: { method: string }) => {
  calls.push(`${init.method} ${url}`);
  const path = url.split('?')[0];
  const body: Record<string, unknown> = {
    '/patterns': { patterns: ['Island strum', 'Strum'] },
    '/chords': { chords: { Am: 'x02210', G: '320003', C: 'x32010' } },
    '/status': { playing: null, chord: null, bpm: 90, knob_bpm: null, bar: null, song: null, servos: false, angles: [], now: 0 },
    '/sessions': { ok: true, session: { score: 0 } },
  };
  return { json: async () => body[path] ?? { ok: true } };
});
vi.stubGlobal('requestAnimationFrame', () => 0);

let session: typeof import('../src/lib/practice/session');

beforeAll(async () => {
  const page = await import('../src/lib/page');
  vi.spyOn(page.twin, 'pluck').mockImplementation(() => {});
  await page.start();
  session = await import('../src/lib/practice/session');
});

test('count-in, live grading by arrival time, saved session', async () => {
  vi.useFakeTimers();
  const riptide = { id: 'riptide', name: 'Riptide', chords: ['Am', 'G', 'C', 'C'], pattern: 'Island strum', bpm: 120 };
  calls.length = 0;
  await session.start(riptide, 120);  // 500 ms beats, 2000 ms bars
  expect(calls).toEqual(['POST /chord?name=', 'POST /song?chords=Am%2CG%2CC%2CC', 'POST /tempo?bpm=120']);
  expect(get(session.run)).toMatchObject({ phase: 'count-in', countIn: 4, total: 8 });
  await vi.advanceTimersByTimeAsync(1500);
  expect(get(session.run).countIn).toBe(1);
  await vi.advanceTimersByTimeAsync(500);  // one bar of count-in: the robot starts
  expect(get(session.run).phase).toBe('playing');
  expect(calls.at(-1)).toBe('POST /play?pattern=Island+strum');

  // the player: right on bar 1 (Am), late on bar 2 (G), wrong on bar 3, silent on bar 4, then right
  const plan: ((f: number) => string | null)[] = [
    () => 'Am', f => (f < 0.7 ? 'C' : 'G'), () => 'G', () => null, () => 'Am', () => 'G', () => 'C', () => 'C',
  ];
  const song = ['Am', 'G', 'C', 'C'];
  for (let i = 0; i < 8; i++) {
    const chord = song[i % 4];
    handlers.bar({ start: i, steps: [[1, 1000], [2, 1000]], chord, next: song[(i + 1) % 4] });
    for (let t = 0; t < 2000; t += 100) {
      feed?.({ t: performance.now(), chord: plan[i](t / 2000) });
      await vi.advanceTimersByTimeAsync(100);
    }
  }
  expect(get(session.run).bars.map(b => b.grade)).toEqual(['hit', 'late', 'miss', 'silent', 'hit', 'hit', 'hit', null]);
  handlers.bar({ start: 9, steps: [[1, 2000]], chord: 'Am', next: 'G' });  // bar 9 starts: bar 8 is graded, the run ends
  await vi.advanceTimersByTimeAsync(0);
  const r = get(session.run);
  expect(r.phase).toBe('done');
  expect(r.bars.map(b => b.grade)).toEqual(['hit', 'late', 'miss', 'silent', 'hit', 'hit', 'hit', 'hit']);
  expect(r.summary?.score).toBe(69);  // 5.5 / 8
  expect(calls).toContain('POST /stop');
  expect(calls.at(-1)).toBe('POST /sessions?song=riptide&bpm=120&results=Am%3Ahit%2CG%3Alate%2CC%3Amiss%2CC%3Asilent%2CAm%3Ahit%2CG%3Ahit%2CC%3Ahit%2CC%3Ahit');
  expect(r.saved).toBe(true);
  expect(feed).toBeNull();  // the mic is let go
  vi.useRealTimers();
});

test('a reading from before a bar started never counts for it', async () => {
  vi.useFakeTimers();
  await session.start({ id: 'loop:Am-G', name: 'Am ↔ G', chords: ['Am', 'G'], pattern: 'Strum', bpm: 120 }, 120);
  await vi.advanceTimersByTimeAsync(2000);
  handlers.bar({ start: 1, steps: [[1, 2000]], chord: 'Am', next: 'G' });
  feed?.({ t: performance.now() - 5000, chord: 'Am' });  // arrived late from the previous bar's time
  await vi.advanceTimersByTimeAsync(1000);
  handlers.bar({ start: 2, steps: [[1, 2000]], chord: 'G', next: 'Am' });
  expect(get(session.run).bars[0].grade).toBe('silent');
  await session.stop();
  expect(get(session.run).phase).toBe('done');
  expect(session.loopFor('Am→G')).toMatchObject({ id: 'loop:Am-G', chords: ['Am', 'G'] });
  vi.useRealTimers();
});
