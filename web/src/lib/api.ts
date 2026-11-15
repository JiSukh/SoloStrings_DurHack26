// The board's REST API (commands) and its socket.io push (state), as typed calls and stores.
// The page never polls: it reads /status once when the socket connects (and on every
// reconnect), then follows the "state" and "bar" events the board pushes.

import { io, type Socket } from 'socket.io-client';
import { writable, type Readable } from 'svelte/store';
import type { Step } from './music/synth';

export type Song = string[];

// GET /status and the "state" event (strummer/player.py state + main.snapshot)
export interface Status {
  playing: string | null;       // pattern name while the robot plays
  chord: string | null;         // chosen chord; null = every string
  bpm: number;                  // the page's tempo (used when no knob is plugged in)
  knob_bpm: number | null;      // the knob's tempo, null when no knob is plugged in
  bar: Bar | null;              // the bar playing now
  song: Song | null;            // loaded progression, one chord per bar
  servos: boolean;              // false = debug mode
  angles: [number, number][];   // pick end angles per string, low E first
  now: number;                  // board clock, seconds (not used for timing: see Bar.arrived)
}

// The "bar" event, at each bar start
export interface Bar {
  start: number;                // board clock, seconds
  steps: Step[];                // [mask, ms] as the robot plays them
  chord: string | null;
  next: string | null;          // chord of the bar after this one
}

// A bar as the page received it: `arrived` (performance.now()) is when it started here.
// The board has no clock sync, so the push's arrival is the best bar start we have.
export interface LiveBar extends Bar { arrived: number }

export interface Result { ok: boolean; error?: string; [k: string]: unknown }

type Params = Record<string, string | number | boolean>;

export async function api<T = Result>(method: 'GET' | 'POST', path: string, params?: Params): Promise<T> {
  const q = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : '';
  const res = await fetch(path + q, { method });
  return res.json() as Promise<T>;
}

// Every command the page sends, with the same paths and parameters as before.
export const board = {
  patterns: () => api<{ patterns: string[] }>('GET', '/patterns').then(r => r.patterns),
  chords: () => api<{ chords: Record<string, string> }>('GET', '/chords').then(r => r.chords),
  status: () => api<Status>('GET', '/status'),
  config: () => api<{ elevenlabs_key: string }>('GET', '/config'),
  play: (pattern: string) => api<Result & { switched?: boolean }>('POST', '/play', { pattern }),
  stop: () => api('POST', '/stop'),
  chord: (name: string) => api('POST', '/chord', { name }),
  tempo: (bpm: number) => api('POST', '/tempo', { bpm }),
  song: (chords: Song) => api<Result & { song?: Song | null }>('POST', '/song', { chords: chords.join(',') }),
  steps: (pattern: string, bpm: number, chord: string, bar_no: number) =>
    api<Result & { chord: string | null; next: string | null; steps: Step[] }>('GET', '/steps', { pattern, bpm, chord, bar_no }),
  pluck: (string: number) => api('POST', '/pluck', { string }),
  reset: () => api('POST', '/reset'),
  angles: (string: number, a: number, b: number) => api<Result & { saved?: boolean }>('POST', '/angles', { string, a, b }),
  servos: (on: boolean) => api('POST', '/servos', { on }),
};

const _server = writable<Status | null>(null);
const _bar = writable<LiveBar | null>(null);
const _connected = writable(false);
export const server: Readable<Status | null> = _server;   // latest board state
export const bar: Readable<LiveBar | null> = _bar;        // latest bar start
export const connected: Readable<boolean> = _connected;

// The knob's tempo when one is plugged in, else the page's.
export const tempoOf = (s: Status | null) => (s && s.knob_bpm !== null && s.knob_bpm !== undefined ? s.knob_bpm : s ? s.bpm : 90);
export const knobIn = (s: Status | null) => !!s && s.knob_bpm !== null && s.knob_bpm !== undefined;

let socket: Socket | null = null;

// Opens the socket and keeps the stores fresh. Safe to call more than once.
export function connect(): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', async () => {
    _connected.set(true);
    try { _server.set(await board.status()); } catch { /* the next push fills it in */ }
  });
  socket.on('disconnect', () => _connected.set(false));
  socket.on('state', (s: Status) => _server.set(s));
  socket.on('bar', (b: Bar) => _bar.set({ ...b, arrived: performance.now() }));
  return socket;
}

// After a command, the push brings the new state; this is for the first paint and for tests.
export async function refresh() {
  try { _server.set(await board.status()); } catch { /* not reachable */ }
}
