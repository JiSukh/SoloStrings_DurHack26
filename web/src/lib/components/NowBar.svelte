<script lang="ts">
  import { knobIn, server } from '../api';

  const knob = $derived(knobIn($server));
</script>

<div class="now">
  <div><small>Chord</small><strong>{$server?.chord || 'All strings'}</strong></div>
  <div>
    <small>Tempo</small><strong>{$server ? (knob ? $server.knob_bpm : $server.bpm) : '–'}</strong>
    <small>{$server ? (knob ? 'knob' : 'slider') : ''}</small>
  </div>
  <div><small>Playing</small><strong class="name">{$server?.playing || '–'}</strong></div>
</div>

<style>
  .now { display: flex; gap: 12px; flex-wrap: wrap; }
  .now div { flex: 1; min-width: 140px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  small { display: block; color: var(--muted); font-size: .8rem; }
  strong { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .name { font-size: 1.1rem; }
</style>
