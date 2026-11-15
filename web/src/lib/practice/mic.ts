// The microphone as a stream of chord readings for grading: matchChord every 100 ms, with the
// same gate and confidence as the Chord-by-ear listener (MicListener.svelte).
import { chroma, FMAX, FMIN, matchChord } from '../music/chroma';
import type { Reading } from './grade';

const FFT = 16384, GATE_DB = -70, MIN_SCORE = 0.85, MIN_MARGIN = 0.01;

// Starts listening (asks for the mic); calls onReading every 100 ms. Returns a stop function.
export async function listen(chords: Record<string, string>, onReading: (r: Reading) => void): Promise<() => void> {
  // the browser's voice processing would filter out the very notes we want
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = FFT; an.smoothingTimeConstant = 0.5;
  ctx.createMediaStreamSource(stream).connect(an);
  const db = new Float32Array(an.frequencyBinCount), binHz = ctx.sampleRate / FFT;
  const timer = setInterval(() => {
    an.getFloatFrequencyData(db);
    let peak = -Infinity;
    for (let k = Math.ceil(FMIN / binHz); k <= FMAX / binHz; k++) peak = Math.max(peak, db[k]);
    const t = performance.now();
    if (peak < GATE_DB) return onReading({ t, chord: null });
    const r = matchChord(chroma(Array.from(db, d => 10 ** (d / 20)), ctx.sampleRate, FFT), chords);
    onReading({ t, chord: r && r.score >= MIN_SCORE && r.margin >= MIN_MARGIN ? r.chord : null });
  }, 100);
  return () => {
    clearInterval(timer);
    stream.getTracks().forEach(tr => tr.stop());
    ctx.close();
  };
}
