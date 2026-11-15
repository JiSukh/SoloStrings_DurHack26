<script lang="ts">
  import { onMount } from 'svelte';
  import { simulating, sound, toggleSim, twin } from '../page';

  let canvas: HTMLCanvasElement;
  onMount(() => {
    twin.attach(canvas);
    return () => twin.detach();
  });
</script>

<h2>Virtual guitar</h2>
<canvas bind:this={canvas} class="twin" aria-label="Virtual guitar: strings light up as they're plucked"></canvas>
<div class="row controls">
  <button class="btn" onclick={toggleSim}>{$simulating ? 'Stop virtual guitar' : 'Play without robot'}</button>
  <label><input type="checkbox" bind:checked={$sound}> Sound</label>
  <span class="muted">Mirrors the robot while it plays, string by string.</span>
</div>

<style>
  .twin { display: block; width: 100%; height: 220px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .controls { margin-top: 8px; }
</style>
