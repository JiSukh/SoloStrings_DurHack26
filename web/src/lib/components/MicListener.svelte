<script lang="ts">
  import { onDestroy } from 'svelte';
  import { chroma, FMAX, FMIN, matchChord } from '../music/chroma';
  import { chords, voter } from '../page';

  const FFT = 16384, GATE_DB = -70, MIN_SCORE = 0.85, MIN_MARGIN = 0.01;
  const vote = voter(10, 6);  // readings every 100 ms: 6 of the last 10 must agree

  let listening = $state(false), busy = $state(false);
  let heard = $state('–'), level = $state(-100);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function start() {
    busy = true;
    try {
      // the browser's voice processing would filter out the very notes we want
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = FFT; an.smoothingTimeConstant = 0.5;
      ctx.createMediaStreamSource(stream).connect(an);
      const db = new Float32Array(an.frequencyBinCount), binHz = ctx.sampleRate / FFT;
      listening = true;
      timer = setInterval(() => {
        an.getFloatFrequencyData(db);
        let peak = -Infinity;
        for (let k = Math.ceil(FMIN / binHz); k <= FMAX / binHz; k++) peak = Math.max(peak, db[k]);
        level = Math.max(-100, peak);
        if (peak < GATE_DB) { heard = 'too quiet'; vote(null); return; }
        const r = matchChord(chroma(Array.from(db, d => 10 ** (d / 20)), ctx.sampleRate, FFT), $chords);
        const sure = !!r && r.score >= MIN_SCORE && r.margin >= MIN_MARGIN;
        heard = r ? `${r.chord} (${Math.round(r.score * 100)}%)${sure ? '' : '?'}` : '–';
        vote(sure && r ? r.chord : null);
      }, 100);
    } catch (e) {
      busy = false;
      heard = window.isSecureContext ? `mic error: ${(e as Error).message}` : 'mic needs http://localhost (use open.sh)';
    }
  }
  onDestroy(() => clearInterval(timer));
</script>

<h2>Chord by ear (microphone)</h2>
<p class="muted">Most reliable: the laptop listens to the strings and works out the chord from the notes ringing. Just fret the chord and let the robot strum; it follows within about a bar. No training needed.</p>
<div class="row">
  <button class="btn primary" disabled={busy} onclick={start}>{listening ? 'Listening' : 'Start listening'}</button>
  <span>Hearing: <span class="detected">{heard}</span></span>
  <meter min="-100" max="-20" low={-70} optimum={-40} value={level} aria-label="Microphone level"></meter>
</div>

<style>
  meter { flex: 1; min-width: 120px; }
</style>
