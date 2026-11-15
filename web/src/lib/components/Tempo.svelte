<script lang="ts">
  import { knobIn, server } from '../api';
  import { setTempo } from '../page';

  let bpm = $state(90);
  let dragging = false;
  // follow the board (another page, voice) unless the slider is being dragged
  $effect(() => { const b = $server?.bpm; if (b !== undefined && !dragging) bpm = b; });
</script>

<h2>Tempo</h2>
<div class="row">
  <input type="range" min="30" max="200" bind:value={bpm} aria-label="Tempo in BPM" disabled={knobIn($server)}
         oninput={() => (dragging = true)} onchange={() => { dragging = false; setTempo(bpm); }}>
  <span>{bpm} BPM</span>
</div>
<p class="muted">The knob sets the tempo when it's plugged in; turn it to 0 to stop.</p>
