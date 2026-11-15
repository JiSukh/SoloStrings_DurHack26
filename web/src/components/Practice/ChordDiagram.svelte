<script lang="ts">
  // A chord box: six strings (low E left), four frets, dots where to press, x / o above.
  let { name, shape, size = 1 }: { name: string; shape: string | null; size?: number } = $props();
  const W = 90, H = 110, left = 15, top = 28, gap = 12, fret = 18;
</script>

<figure style="width:{W * size}px">
  <svg viewBox="0 0 {W} {H}" width={W * size} height={H * size} role="img" aria-label="{name}: {shape ?? 'all strings'}">
    {#each [0, 1, 2, 3, 4] as f (f)}
      <line x1={left} x2={left + 5 * gap} y1={top + f * fret} y2={top + f * fret} stroke="currentColor" stroke-width={f ? 1 : 3} />
    {/each}
    {#each [0, 1, 2, 3, 4, 5] as s (s)}
      <line x1={left + s * gap} x2={left + s * gap} y1={top} y2={top + 4 * fret} stroke="currentColor" />
      {#if shape}
        {#if shape[s] === 'x' || shape[s] === '0'}
          <text x={left + s * gap} y={top - 8} text-anchor="middle" font-size="11" fill="currentColor">{shape[s] === 'x' ? '×' : 'o'}</text>
        {:else}
          <circle cx={left + s * gap} cy={top + (Number(shape[s]) - 0.5) * fret} r="5" fill="var(--accent)" />
        {/if}
      {/if}
    {/each}
  </svg>
  <figcaption>{name}</figcaption>
</figure>

<style>
  figure { margin: 0; text-align: center; color: var(--fg); }
  figcaption { font-weight: 700; font-size: 1.1rem; }
</style>
