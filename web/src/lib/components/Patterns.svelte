<script lang="ts">
  import { server } from '../api';
  import { message, patterns, play, selected, selectPattern, stop } from '../page';
</script>

<h2>Pattern</h2>
<div class="grid" role="group" aria-label="Pattern">
  {#each $patterns as name (name)}
    <button aria-pressed={$selected === name} onclick={() => selectPattern(name)}>{name}</button>
  {/each}
</div>
<div class="controls">
  <button class="btn primary" onclick={() => play()}>{$server?.playing ? 'Switch pattern' : 'Play'}</button>
  <button class="btn" onclick={stop}>Stop</button>
</div>
<p class="muted status" role="status">{$message}</p>

<style>
  .controls { display: flex; gap: 10px; margin-top: 16px; }
  .controls button { flex: 1; }
  .status { min-height: 1.4em; }
</style>
