// The page's wiring without a browser or a board: socket pushes land in the stores, /status is
// read once per connect (never polled), the mirror plays each pushed bar from its arrival, the
// mic/camera vote, and the voice plugin's typed commands drive the same actions as the buttons.
import { get } from 'svelte/store';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

// a fake socket.io: the test fires its events by hand
const handlers: Record<string, (...a: unknown[]) => void> = {};
vi.mock('socket.io-client', () => ({ io: () => ({ on: (ev: string, fn: (...a: unknown[]) => void) => { handlers[ev] = fn; } }) }));

// a fake board behind fetch: answers like servo-strummer/python/main.py, records every call
const calls: string[] = [];
let state = {
  playing: null as string | null, chord: null as string | null, bpm: 90, knob_bpm: null as number | null, bar: null,
  song: null as string[] | null, servos: true, angles: Array.from({ length: 6 }, () => [60, 120]), now: 0,
};
const replies: Record<string, (q: URLSearchParams) => unknown> = {
  '/patterns': () => ({ patterns: ['Strum', 'Travis picking', 'Random'] }),
  '/chords': () => ({ chords: { C: 'x32010', G: '320003', Am: 'x02210' } }),
  '/status': () => state,
  '/play': q => (state.playing ? { ok: true, switched: true } : { ok: true }),
  '/stop': () => ({ ok: true }),
  '/chord': q => { state.chord = q.get('name') || null; return { ok: true }; },
  '/tempo': q => { state.bpm = Number(q.get('bpm')); return { ok: true }; },
  '/song': q => { const c = q.get('chords') || ''; state.song = c ? c.split(',') : null; return { ok: true, song: state.song }; },
  '/steps': () => ({ ok: true, chord: null, next: null, steps: [[1, 500], [2, 500]] }),
  '/servos': () => ({ ok: true }),
};
vi.stubGlobal('fetch', async (url: string, init: { method: string }) => {
  const [path, query] = url.split('?');
  calls.push(`${init.method} ${path}${query ? '?' + query : ''}`);
  return { json: async () => replies[path](new URLSearchParams(query)) };
});
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});

let api: typeof import('../src/lib/api');
let page: typeof import('../src/lib/page');
let commands: typeof import('../src/plugins/voice/commands');

beforeAll(async () => {
  api = await import('../src/lib/api');
  page = await import('../src/lib/page');
  commands = await import('../src/plugins/voice/commands');
  await page.start();
});
beforeEach(() => { calls.length = 0; });
afterEach(() => vi.useRealTimers());

const push = (ev: string, msg: unknown) => handlers[ev](msg);
const status = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; push('state', { ...state }); };

test('start-up reads the lists and the status once, then follows pushes', () => {
  expect(get(page.patterns)).toEqual(['Strum', 'Travis picking', 'Random']);
  expect(get(page.selected)).toBe('Strum');
  expect(get(api.server)?.bpm).toBe(90);
  status({ chord: 'G', knob_bpm: 120 });
  expect(get(api.server)?.chord).toBe('G');
  expect(api.tempoOf(get(api.server))).toBe(120);
  expect(api.knobIn(get(api.server))).toBe(true);
  expect(calls).toEqual([]);  // a push needs no request
  status({ chord: null, knob_bpm: null });
});

test('never polls: no /status request while time passes, one per (re)connect', async () => {
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(10000);
  expect(calls.filter(c => c.startsWith('GET /status'))).toEqual([]);
  handlers.connect();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.filter(c => c.startsWith('GET /status'))).toHaveLength(1);
  expect(get(api.connected)).toBe(true);
  handlers.disconnect();
  expect(get(api.connected)).toBe(false);
});

test('a pushed bar plays on the virtual guitar from when it arrived, and is announced', () => {
  vi.useFakeTimers();
  const heard: unknown[] = [];
  const off = page.onBar((chord, next, end, beat) => heard.push([chord, next, Math.round(end - performance.now()), beat]));
  const plucked: number[] = [];
  const pluck = vi.spyOn(page.twin, 'pluck').mockImplementation(s => { plucked.push(s); });
  push('bar', { start: 1, steps: [[1, 100], [32, 300]], chord: 'C', next: 'G' });
  expect(get(api.bar)?.chord).toBe('C');
  vi.advanceTimersByTime(50);
  expect(plucked).toEqual([0]);  // low E at once
  vi.advanceTimersByTime(100);
  expect(plucked).toEqual([0, 5]);  // high e 100 ms after the push
  expect(page.twin.shape).toBe('x32010');
  expect(heard).toEqual([['C', 'G', 400, 100]]);
  pluck.mockRestore();
  off();
});

test('the knob at 0 says so while idle', () => {
  status({ knob_bpm: 0 });
  expect(get(page.message)).toBe(page.AT_ZERO);
  status({ knob_bpm: 90 });
  expect(get(page.message)).toBe('');
  status({ knob_bpm: null });
});

test('the knob button switching patterns moves the selection', () => {
  status({ playing: 'Travis picking' });
  expect(get(page.selected)).toBe('Travis picking');
  status({ playing: null });
});

test('mic / camera vote: the chord changes only when enough readings agree', async () => {
  const vote = page.voter(5, 3);
  vote('C'); vote('G'); vote(null);
  expect(calls).toEqual([]);
  vote('G'); vote('G');
  await Promise.resolve();
  expect(calls).toEqual(['POST /chord?name=G']);
  vote('G');  // already sent
  expect(calls).toHaveLength(1);
});

test('voice commands drive the same actions as the buttons', async () => {
  expect(await commands.runCommand({ action: 'play', pattern: 'Travis picking', bpm: 100 })).toBe('Playing Travis picking at 100.');
  expect(calls).toEqual(['POST /tempo?bpm=100', 'POST /play?pattern=Travis+picking']);
  expect(get(page.selected)).toBe('Travis picking');
  status({ playing: 'Travis picking' });
  calls.length = 0;
  expect(await commands.runCommand({ action: 'next' })).toBe('Switching to Random.');
  expect(await commands.runCommand({ action: 'tempo_delta', delta: -10 })).toBe('Tempo 90.');
  expect(await commands.runCommand({ action: 'chord', chord: 'Am' })).toBe('Chord A minor.');
  expect(await commands.runCommand({ action: 'song', chords: ['Am', 'G'], name: 'a song' })).toBe('Loaded a song. It uses A minor, G major.');
  expect(calls).toEqual(['POST /play?pattern=Random', 'POST /tempo?bpm=90', 'POST /chord?name=Am',
                         'POST /song?chords=Am%2CG', 'POST /chord?name=']);  // a song clears the chosen chord
  expect(await commands.runCommand({ action: 'stop' })).toBe('Stopping.');
  status({ playing: null, knob_bpm: 100 });
  expect(await commands.runCommand({ action: 'tempo', bpm: 120 })).toBe('The knob sets the tempo. Turn the knob.');
  status({ knob_bpm: null });
  expect(await commands.runCommand({ action: 'explain', chord: 'C' })).toMatch(/^C major\. Low E string: not played/);
  expect(page.twin.shape).toBe('x32010');
});

test('coach tools: unknown names are refused with the list, known ones run', async () => {
  const said: string[] = [];
  const tools = commands.coachHandlers(r => said.push(r));
  expect(tools.set_chord({ chord: 'H' })).toBe('Unknown chord. Use one of: C, G, Am');
  expect(await tools.set_chord({ chord: 'am' })).toBe('Chord A minor.');
  expect(tools.play_pattern({ pattern: 'polka' })).toMatch(/^Unknown pattern/);
  expect(JSON.parse(tools.get_state() as string)).toMatchObject({ tempo: 90 });
  expect(said).toEqual(['Chord A minor.']);
});

test('play without robot asks for each bar just before it and stops when the robot plays', async () => {
  vi.useFakeTimers();
  vi.spyOn(page.twin, 'audio').mockImplementation(() => ({}) as AudioContext);
  vi.spyOn(page.twin, 'pluck').mockImplementation(() => {});
  page.toggleSim();
  expect(get(page.simulating)).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.filter(c => c.startsWith('GET /steps'))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);  // one 1000 ms bar later: the next one was fetched 300 ms early
  expect(calls.filter(c => c.startsWith('GET /steps'))).toHaveLength(2);
  push('bar', { start: 2, steps: [[1, 100]], chord: null, next: null });  // the robot took over
  expect(get(page.simulating)).toBe(false);
  vi.restoreAllMocks();
});
