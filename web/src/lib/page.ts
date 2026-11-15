// What the page knows and does, shared by every component and the voice plugin: the pattern
// and chord lists, the selected pattern, the status line, the virtual guitar, and the actions
// (play, stop, tempo, chord, song, ...) as plain functions. Components never talk to each other
// directly; they read these stores and call these functions.

import { get, writable } from 'svelte/store';
import { bar, board, connect, knobIn, refresh, server, tempoOf, type Song } from './api';
import { barLength, VirtualGuitar } from './music/synth';

export const patterns = writable<string[]>([]);
export const chords = writable<Record<string, string>>({});
export const selected = writable<string | null>(null);  // pattern to play; follows the knob button
export const message = writable('');                    // the status line under the controls
export const simulating = writable(false);              // "Play without robot" is on

export const twin = new VirtualGuitar();
// the virtual guitar's Sound checkbox; turned on by debug mode and Play without robot
export const sound = writable(false);
sound.subscribe(on => {
  twin.sound = on;
  if (on) twin.audio();  // only ever set true from a click, so the AudioContext may start
});

// Whoever wants to hear about each bar the robot (or the virtual guitar) starts: the voice
// plugin uses it to call out the next chord in time.
export type BarListener = (chord: string | null, next: string | null, barEndAt: number, beatMs: number) => void;
const barListeners = new Set<BarListener>();
export function onBar(fn: BarListener) {
  barListeners.add(fn);
  return () => barListeners.delete(fn);
}
const announce: BarListener = (...a) => barListeners.forEach(fn => fn(...a));

let explaining = false;  // the virtual guitar shows a chord's fingering for a while (voice "how do I play")
let explainTimer: ReturnType<typeof setTimeout> | undefined;
let sentChord: string | null = null;  // what the mic / camera vote last sent
let sim: { next: number; bar: number; timer?: ReturnType<typeof setTimeout> } | null = null;

const shapeOf = (chord: string | null | undefined) => (chord && get(chords)[chord]) || null;
export const AT_ZERO = 'Knob is at 0: turn it up to play';

// ---------- start-up ----------

let started = false;
export async function start() {
  if (started) return;
  started = true;
  connect();
  const [p, c] = await Promise.all([board.patterns(), board.chords()]);
  chords.set(c);
  patterns.set(p);
  if (!get(selected)) selected.set(p[0]);
  await refresh();

  // the robot started a bar: mirror it on the virtual guitar, from the moment the push arrived
  bar.subscribe(b => {
    if (!b) return;
    stopSim();
    const len = barLength(b.steps);
    twin.playBar(b.steps, b.arrived - performance.now(), shapeOf(b.chord));
    announce(b.chord, b.next, b.arrived + len, len / 4);
  });
  server.subscribe(s => {
    if (!s) return;
    if (!s.playing && !sim && !explaining) twin.shape = shapeOf(s.chord);
    if (s.playing && s.playing !== get(selected)) selected.set(s.playing);  // the knob button switched it
    const m = get(message);
    if (knobIn(s) && s.knob_bpm === 0 && !s.playing) message.set(AT_ZERO);
    else if (m === AT_ZERO) message.set('');
  });
}

// ---------- playing ----------

export async function play(name = get(selected)) {
  if (!name) return { ok: false, error: 'pick a pattern' };
  selected.set(name);
  stopSim();
  const r = await board.play(name);
  message.set(!r.ok ? r.error || 'failed' : r.switched ? 'Switching at the next bar…' : '');
  return r;
}

export async function stop() {
  stopSim();
  await board.stop();
  message.set('Stopping…');
}

// Clicking a pattern selects it; while playing, it also switches at the next bar.
export async function selectPattern(name: string) {
  selected.set(name);
  if (get(server)?.playing) await board.play(name);
}

// The pattern `step` places away from the current one, wrapping round (voice "next" / "back").
export function stepPattern(step: number) {
  const list = get(patterns), s = get(server);
  const at = list.indexOf((s && s.playing) || get(selected) || list[0]);
  return list[(at + step + list.length) % list.length];
}

export async function setTempo(bpm: number) {
  bpm = Math.min(200, Math.max(30, Math.round(bpm)));
  await board.tempo(bpm);
  return bpm;
}

export async function setChord(name: string) {
  sentChord = name || null;
  await board.chord(name);
}

// Mic and camera vote: the chord changes only when `agree` of the last `size` readings say the
// same thing, so it doesn't flicker mid-change.
export function voter(size: number, agree: number) {
  const history: (string | null)[] = [];
  return (chord: string | null) => {
    history.push(chord);
    if (history.length > size) history.shift();
    const counts: Record<string, number> = {};
    for (const c of history) if (c) counts[c] = (counts[c] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= agree && top[0] !== sentChord) setChord(top[0]);
  };
}
export const detectedChord = () => sentChord;

export async function loadSong(names: Song) {
  const r = await board.song(names);
  if (r.ok && names.length) await setChord('');  // a chosen chord would override the song
  return r;
}

// Voice "how do I play F": the dots on the virtual guitar for 15 s.
export function explain(chord: string) {
  explaining = true;
  twin.shape = shapeOf(chord);
  clearTimeout(explainTimer);
  explainTimer = setTimeout(() => { explaining = false; }, 15000);
}

// ---------- virtual guitar without the robot ----------

async function simBar() {
  if (!sim) return;
  const s = get(server), bpm = tempoOf(s);
  if (bpm === 0) { stopSim(); message.set(AT_ZERO); return; }
  const r = await board.steps(get(selected) || get(patterns)[0], bpm, (s && s.chord) || '', sim.bar++);
  if (!sim || !r.ok) return stopSim();
  twin.playBar(r.steps, sim.next - performance.now(), shapeOf(r.chord));  // r.chord: a song's own chord
  sim.next += barLength(r.steps);
  announce(r.chord, r.next, sim.next, barLength(r.steps) / 4);
  sim.timer = setTimeout(simBar, sim.next - performance.now() - 300);  // fetch the next bar just before
}

export function stopSim() {
  if (!sim) return;
  clearTimeout(sim.timer);
  sim = null;
  twin.stop();
  simulating.set(false);
}

export function toggleSim() {
  if (sim) return stopSim();
  if (get(server)?.playing) { message.set('The robot is playing: the virtual guitar is already mirroring it'); return; }
  sound.set(true);
  sim = { next: performance.now() + 150, bar: 0 };
  simulating.set(true);
  simBar();
}

// ---------- setup ----------

export async function pluck(s: number) {
  const r = await board.pluck(s);
  message.set(r.ok ? '' : r.error || 'failed');
  if (r.ok) {
    if (s === -1) [0, 1, 2, 3, 4, 5].forEach(i => setTimeout(() => twin.pluck(i), i * 300));
    else twin.pluck(s);
  }
}

export async function resetPicks() {
  const r = await board.reset();
  message.set(r.ok ? '' : r.error || 'failed');
  if (r.ok) twin.reset();
}

export async function setAngles(string: number, a: number, b: number) {
  const r = await board.angles(string, a, b);
  message.set(r.ok ? (r.saved ? '' : r.error || '') : r.error || 'failed');
}

export async function setDebug(debug: boolean) {
  await board.servos(!debug);
  if (debug) sound.set(true);  // hear what it would play
}
