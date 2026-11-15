// One practice run: count in for a bar, have the robot play the song, put each mic reading in
// the bar that was current when it arrived, grade each bar when the next one starts, and save
// the run when enough bars are done. The view (components/Practice) only reads `run`.
import { get, writable } from 'svelte/store';
import { bar as liveBar, board } from '../api';
import { barLength } from '../music/synth';
import * as page from '../page';
import { saveSession, type SongInfo } from './api';
import { gradeBar, summarise, type Bar, type Grade, type Reading, type Summary } from './grade';
import { listen } from './mic';

export const MIN_BARS = 8;  // short songs repeat until at least this many bars are graded

export interface RunBar { chord: string; next: string | null; grade: Grade | null }
export interface Run {
  phase: 'idle' | 'count-in' | 'playing' | 'done' | 'error';
  song: SongInfo | null;
  bpm: number;
  countIn: number;              // beats left in the count-in
  bars: RunBar[];               // graded so far, plus the one playing (grade null)
  total: number;                // bars to play
  summary: Summary | null;
  saved: boolean;
  error: string;
}

const idle: Run = { phase: 'idle', song: null, bpm: 90, countIn: 0, bars: [], total: 0, summary: null, saved: false, error: '' };
export const run = writable<Run>(idle);
export const practiceRequested = writable(0);  // bumped to ask App to show the Practice tab

let stopMic: (() => void) | null = null;
let offBar: (() => void) | null = null;
let current: Bar | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

const set = (patch: Partial<Run>) => run.update(r => ({ ...r, ...patch }));

function cleanup() {
  stopMic?.();
  stopMic = null;
  offBar?.();
  offBar = null;
  current = null;
  timers.forEach(clearTimeout);
  timers = [];
}

function onReading(r: Reading) {
  if (current && r.t >= current.start) current.readings.push(r);  // the bar current when it arrived
}

// Grades the bar that just ended; returns false once the run is complete.
function closeBar(): boolean {
  if (!current) return true;
  const grade = gradeBar(current);
  const r = get(run);
  const bars = r.bars.slice();
  bars[bars.length - 1] = { ...bars[bars.length - 1], grade };
  set({ bars });
  current = null;
  return bars.length < r.total;
}

async function finish() {
  cleanup();
  await page.stop();
  const r = get(run);
  const results = r.bars.filter(b => b.grade).map(b => [b.chord, b.grade] as [string, Grade]);
  set({ phase: 'done', summary: summarise(results) });
  if (r.song && results.length) {
    const s = await saveSession(r.song.id, r.bpm, results).catch(() => null);
    set({ saved: !!s?.ok });
  }
}

// Starts a run. Call from a click: it asks for the microphone.
export async function start(song: SongInfo, bpm: number) {
  cleanup();
  run.set({ ...idle, phase: 'count-in', song, bpm, countIn: 4,
            total: Math.max(MIN_BARS, Math.ceil(MIN_BARS / song.chords.length) * song.chords.length) });
  try {
    stopMic = await listen(get(page.chords), onReading);
    page.stopSim();
    await page.setChord('');                 // a chosen chord would override the song
    const r = await board.song(song.chords);  // also restarts the song from its first chord
    if (!r.ok) throw new Error(r.error || 'the board refused the song');
    await page.setTempo(bpm);
  } catch (e) {
    cleanup();
    set({ phase: 'error', error: (e as Error).message });
    return;
  }
  // one bar of count-in, then the robot starts on the song's first chord
  const beat = 60000 / bpm;
  for (let i = 1; i <= 4; i++) timers.push(setTimeout(() => set({ countIn: 4 - i }), beat * i));
  timers.push(setTimeout(async () => {
    set({ phase: 'playing' });
    let skip = true;  // the store's current value, from before this run
    offBar = liveBar.subscribe(b => {
      if (skip) { skip = false; return; }
      if (!b || !b.chord) return;
      if (!closeBar()) { finish(); return; }
      current = { chord: b.chord, start: b.arrived, length: barLength(b.steps), readings: [] };
      set({ bars: [...get(run).bars, { chord: b.chord, next: b.next, grade: null }] });
    });
    const p = await page.play(song.pattern);
    if (!p.ok) { cleanup(); set({ phase: 'error', error: p.error || 'the robot did not start' }); }
  }, beat * 4));
}

export async function stop() {
  const r = get(run);
  if (r.phase === 'playing') { closeBar(); await finish(); return; }
  cleanup();
  run.set(idle);
}

// A 2-chord loop for a hard change, e.g. "Am→G" (from the Progress view).
export function loopFor(change: string, bpm = 70): SongInfo {
  const [a, b] = change.split('→');
  return { id: `loop:${a}-${b}`, name: `${a} ↔ ${b}`, chords: [a, b], pattern: 'Strum', bpm };
}
