// chroma.ts (was listen.js): synthesise strummed guitar chords (harmonics, slight detune, noise),
// take the spectrum like the browser's AnalyserNode (Blackman window, 16384-point FFT at 48 kHz),
// and check every chord is recognised: with all its strings, and with only strings 2-5
// (what the robot plays while a D-type chord is still set). Ported from tests/listen_test.mjs.
import { expect, test } from 'vitest';
import { chroma, matchChord, template } from '../src/lib/music/chroma';
import { CHORDS } from './music';

const SR = 48000, N = 16384, OPEN = [40, 45, 50, 55, 59, 64];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function fftMag(x: Float64Array) {
  const re = Float64Array.from(x), im = new Float64Array(N);
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const a = i + k, b = a + len / 2;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  return Array.from({ length: N / 2 }, (_, k) => Math.hypot(re[k], im[k]) / N);
}

function strum(shape: string, strings: number[]) {
  const x = new Float64Array(N);
  for (const s of strings) {
    if (shape[s] === 'x') continue;
    const f0 = 440 * 2 ** ((OPEN[s] + Number(shape[s]) - 69) / 12) * (1 + (rand() - .5) * 0.006);  // ±5 cents out of tune
    for (let h = 1; h <= 8; h++) {
      const f = f0 * h * Math.sqrt(1 + 0.0001 * h * h), amp = (0.5 + rand()) / h, ph = rand() * 6.3;
      for (let i = 0; i < N; i++) x[i] += amp * Math.sin(2 * Math.PI * f * i / SR + ph);
    }
  }
  for (let i = 0; i < N; i++) {
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);
    x[i] = (x[i] + (rand() - .5) * 0.5) * w;  // noise: servo whir, room
  }
  return fftMag(x);
}

test('every chord is heard, with all strings and with only the top four', () => {
  const fails: string[] = [];
  for (const [name, shape] of Object.entries(CHORDS)) {
    for (const strings of [[0, 1, 2, 3, 4, 5], [2, 3, 4, 5]]) {
      const r = matchChord(chroma(strum(shape, strings), SR, N), CHORDS);
      if (!r || r.chord !== name) fails.push(`${name} on strings ${strings.join('')} heard as ${r && r.chord}`);
    }
  }
  expect(fails).toEqual([]);
}, 60000);

test('silence matches nothing; template weights the chord notes most', () => {
  expect(matchChord(new Array(12).fill(0), CHORDS)).toBeNull();
  const t = template('x32010');  // C: C E G
  expect(t[0] > t[2] && t[4] > t[2] && t[7] > t[2]).toBe(true);
});
