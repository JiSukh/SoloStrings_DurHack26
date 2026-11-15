// Chord recognition by ear: which notes are ringing (a 12-bin "chroma" from the spectrum),
// matched against the notes of each chord shape. Pure functions, no browser APIs, so it can
// be tested in node.

const OPEN_MIDI = [40, 45, 50, 55, 59, 64];  // E2 A2 D3 G3 B3 E4, low E first
export const FMIN = 75, FMAX = 1500;          // low E fundamental up to the useful harmonics

// Expected chroma of a chord shape like "x32010", for the strings in `play` (default: all
// it doesn't mute). A plucked string also rings at its 3rd and 5th harmonics, which land on
// the fifth and the major third above it, so those get a little weight too.
export function template(shape, play = [0, 1, 2, 3, 4, 5]) {
  const t = new Array(12).fill(0);
  for (const s of play) {
    const fret = shape[s];
    if (fret === 'x') continue;
    const pc = (OPEN_MIDI[s] + Number(fret)) % 12;
    t[pc] += 1;
    t[(pc + 7) % 12] += 0.3;
    t[(pc + 4) % 12] += 0.15;
  }
  return t;
}

// Chroma from linear FFT magnitudes: only spectral peaks within 0.35 semitone of a note
// count, which ignores most servo whir and room noise.
export function chroma(mags, sampleRate, fftSize) {
  const c = new Array(12).fill(0);
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.ceil(FMIN / binHz)), hi = Math.min(mags.length - 2, Math.floor(FMAX / binHz));
  for (let k = lo; k <= hi; k++) {
    const m = mags[k];
    if (m <= mags[k - 1] || m < mags[k + 1]) continue;  // not a peak
    // parabolic interpolation for the true peak frequency
    const a = mags[k - 1], b = mags[k + 1];
    const shift = (a - b) / (2 * (a - 2 * m + b) || 1);
    const midi = 69 + 12 * Math.log2(((k + shift) * binHz) / 440);
    const note = Math.round(midi);
    if (Math.abs(midi - note) > 0.35) continue;
    c[((note % 12) + 12) % 12] += m;
  }
  return c;
}

function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < 12; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

// Best chord for a chroma among { name: shape }. The robot may only be strumming the
// current chord's strings, so each chord is also tried as just its top four strings.
// Returns { chord, score, margin } (margin = lead over the runner-up chord), or null.
export function matchChord(c, chords) {
  const scores = [];
  for (const [name, shape] of Object.entries(chords)) {
    const s = Math.max(cosine(c, template(shape)), cosine(c, template(shape, [2, 3, 4, 5])));
    scores.push([name, s]);
  }
  scores.sort((x, y) => y[1] - x[1]);
  if (!scores.length || !scores[0][1]) return null;
  return { chord: scores[0][0], score: scores[0][1], margin: scores[0][1] - (scores[1] ? scores[1][1] : 0) };
}
