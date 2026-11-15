<script lang="ts">
  import { pluck, resetPicks } from '../page';

  const PINS = [2, 4, 7, 8, 12, 13];  // same as SERVO_PINS in sketch.ino
  const NAMES = ['Low E', 'A', 'D', 'G', 'B', 'High e'];
</script>

<h2>String test</h2>
<div class="chips" role="group" aria-label="Pluck one string">
  {#each NAMES as name, s (name)}
    <button onclick={() => pluck(s)}>{name}<br><small class="muted">pin {PINS[s]}</small></button>
  {/each}
  <button onclick={() => pluck(-1)}>All, one by one<br><small class="muted">low E → high e</small></button>
  <button onclick={resetPicks}>Reset servos<br><small class="muted">all picks to start</small></button>
</div>
<p class="muted">Each button plucks one string once, so you can check every servo and that it's on the right string.</p>
