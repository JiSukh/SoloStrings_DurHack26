<script lang="ts">
  import { server } from '../api';
  import { pluck, setAngles } from '../page';

  const NAMES = ['Low E', 'A', 'D', 'G', 'B', 'High e'];
  // the sliders start from the board's saved angles, once; after that they are the source
  let angles = $state<[number, number][] | null>(null);
  $effect(() => { if (!angles && $server?.angles) angles = $server.angles.map(([a, b]) => [a, b]); });
</script>

<h2>Calibrate picks</h2>
<p class="muted">If a pick hits the next string, pull in that side of its swing: drag a slider and the servo moves there; press Pluck to try it. Saved on the board.</p>
{#if angles}
  <div class="calib">
    {#each NAMES as name, s (name)}
      <strong>{name}</strong>
      {#each ['A', 'B'] as side, k (side)}
        <label>
          {side}
          <input type="range" min="10" max="170" bind:value={angles[s][k]} aria-label="{name} side {side} angle"
                 onchange={() => angles && setAngles(s, angles[s][0], angles[s][1])}>
          <span>{angles[s][k]}°</span>
        </label>
      {/each}
      <button class="btn" onclick={() => pluck(s)}>Pluck</button>
    {/each}
  </div>
{:else}
  <p class="muted">Waiting for the board…</p>
{/if}

<style>
  .calib { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 8px 12px; align-items: center; }
  .calib label { display: flex; align-items: center; gap: 6px; font-size: .9rem; color: var(--muted); }
  .calib input { min-width: 0; }
  @media (max-width: 560px) { .calib { grid-template-columns: 1fr 1fr; } }
</style>
