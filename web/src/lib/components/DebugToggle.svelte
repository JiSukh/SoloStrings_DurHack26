<script lang="ts">
  import { server } from '../api';
  import { setDebug } from '../page';

  const debug = $derived(!!$server && !$server.servos);
</script>

<label class="debug" class:on={debug}>
  <input type="checkbox" checked={debug} onchange={e => setDebug(e.currentTarget.checked)}>
  <span><strong>Debug mode</strong>: servos off. Everything else runs; the virtual guitar plays instead.</span>
</label>

<style>
  .debug { display: flex; gap: 10px; align-items: center; padding: 10px 12px; margin: 14px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); cursor: pointer; }
  .debug input { width: 18px; height: 18px; accent-color: var(--accent); }
  .debug.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--card)); }
</style>
