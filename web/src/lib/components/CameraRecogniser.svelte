<script lang="ts">
  // Experimental: needs internet for MediaPipe (loaded from its CDN only when the camera starts).
  // App.svelte imports this component lazily, so it isn't in the page's main bundle either.
  import { onDestroy } from 'svelte';
  import { buildIndex, features, knn, type Index, type Landmark, type Samples } from '../music/handpose';
  import { chords, voter } from '../page';

  const K = 9, MIN_SHARE = 0.6, MAX_SAMPLES = 400;
  const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const STORE = 'servo-strummer-chord-samples-v2';  // v2 = knuckle-frame features; v1 samples don't fit
  const vote = voter(12, 8);

  let samples: Samples = {};
  try { samples = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { samples = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(samples)); } catch { /* private window */ } };

  let index: Index = buildIndex(samples);
  let video: HTMLVideoElement, overlay: HTMLCanvasElement;
  let started = $state(false), starting = $state(false), recordingNow = $state(false);
  let detected = $state('–'), trainChord = $state(''), summary = $state(describe());
  // MediaPipe's HandLandmarker, from the CDN (no types bundled)
  let landmarker: { detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: Landmark[][] } } | null = null;
  let recording: { chord: string; until: number } | null = null, frame = 0;

  $effect(() => { if (!trainChord) trainChord = Object.keys($chords)[0] || ''; });

  function describe() {
    const parts = Object.entries(samples).filter(([, l]) => l.length).map(([c, l]) => `${c}: ${l.length}`);
    return parts.length ? `Recorded — ${parts.join(', ')}` : 'No chords recorded yet.';
  }

  async function start() {
    starting = true;
    detected = 'loading…';
    try {
      // loaded only now: it's large and comes from the internet, so the rest of the page never waits for it
      const { FilesetResolver, HandLandmarker } = await import(/* @vite-ignore */ `${MEDIAPIPE}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL }, runningMode: 'VIDEO', numHands: 1,
      });
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      await video.play();
      started = true;
      detected = '–';
      frame = requestAnimationFrame(loop);
    } catch (e) {
      starting = false;
      detected = window.isSecureContext ? `camera error: ${(e as Error).message}` : 'camera needs http://localhost (use open.sh)';
    }
  }

  function draw(lm?: Landmark[]) {
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!lm) return;
    ctx.fillStyle = '#ff7a3d';
    for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, 7); ctx.fill(); }
  }

  function loop() {
    try { step(); } catch (e) { detected = `error: ${(e as Error).message}`; console.error(e); }
    frame = requestAnimationFrame(loop);  // keep going even if one frame fails
  }

  function step() {
    if (!landmarker || video.readyState < 2) return;
    const res = landmarker.detectForVideo(video, performance.now());
    const lm = res.landmarks && res.landmarks[0];
    draw(lm);
    if (lm) {
      const f = features(lm, video.videoWidth / video.videoHeight);
      if (recording && performance.now() < recording.until) {
        const list = (samples[recording.chord] ||= []);
        if (list.length < MAX_SAMPLES) list.push(f);
      }
      const r = knn(f, index.norm, index.zSamples, K);
      detected = r ? `${r.chord} (${Math.round(r.share * 100)}%)` : index.zSamples.length ? 'not sure' : 'hand found: record chords first';
      vote(r && r.share >= MIN_SHARE ? r.chord : null);
    } else {
      detected = 'no hand';  // keep the last chord while the hand moves
    }
    if (recording && performance.now() >= recording.until) {
      recording = null;
      recordingNow = false;
      save(); index = buildIndex(samples); summary = describe();
    }
  }

  function record() {
    recording = { chord: trainChord, until: performance.now() + 3000 };
    recordingNow = true;
  }

  function clear() {
    if (!confirm('Delete all recorded chord samples?')) return;
    samples = {}; save(); index = buildIndex(samples); summary = describe();
  }

  onDestroy(() => {
    cancelAnimationFrame(frame);
    (video?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
  });
</script>

<p class="muted">Point the laptop camera at the fretboard. Teach each chord once: pick it, hold the shape, press Record. Then the detected chord is sent to the strummer automatically.</p>
<div class="row top">
  <button class="btn primary" disabled={starting} onclick={start}>Start camera</button>
  <span>Detected: <span class="detected">{detected}</span></span>
</div>
<div class="cam"><video bind:this={video} playsinline muted></video><canvas bind:this={overlay}></canvas></div>
<div class="row train">
  <select bind:value={trainChord} aria-label="Chord to record">
    {#each Object.entries($chords) as [name, shape] (name)}
      <option value={name}>{name}  ({shape})</option>
    {/each}
  </select>
  <button class="btn" disabled={!started || recordingNow} onclick={record}>{recordingNow ? 'Recording…' : 'Record 3 s'}</button>
  <button class="btn" onclick={clear}>Clear samples</button>
</div>
<p class="muted">{summary}</p>

<style>
  .top { margin-bottom: 10px; }
  .train { margin-top: 12px; }
  .cam { position: relative; width: 100%; max-width: 640px; aspect-ratio: 4 / 3; background: #000; border-radius: 12px; overflow: hidden; }
  .cam video, .cam canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
</style>
