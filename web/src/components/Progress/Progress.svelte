<script lang="ts">
  import { progress as loadProgress, songs as loadSongs, type Progress, type SongInfo } from '../../lib/practice/api';
  import { loopFor, practiceRequested, run, start } from '../../lib/practice/session';

  let { visible }: { visible: boolean } = $props();
  let data = $state<Progress | null>(null), names = $state<Record<string, string>>({});

  async function refresh() {
    data = await loadProgress().catch(() => null);
    if (!Object.keys(names).length) {
      const list: SongInfo[] = await loadSongs().catch(() => []);
      names = Object.fromEntries(list.map(s => [s.id, s.name]));
    }
  }
  // fresh numbers whenever the tab is shown, and after each saved run
  $effect(() => { if (visible) refresh(); });
  $effect(() => { if ($run.saved) refresh(); });

  const nameOf = (id: string) => names[id] || (id.startsWith('loop:') ? id.slice(5).replace('-', ' ↔ ') : id);
  const W = 300, H = 80;
  function line(history: { score: number }[]) {
    const n = history.length, x = (i: number) => (n === 1 ? W / 2 : (i * (W - 10)) / (n - 1) + 5);
    return history.map((h, i) => `${x(i).toFixed(1)},${(H - 5 - (h.score * (H - 10)) / 100).toFixed(1)}`).join(' ');
  }

  function practise(change: string) {
    start(loopFor(change), 70);
    practiceRequested.update(n => n + 1);
  }
</script>

<h2>Progress</h2>
{#if !data?.songs || !Object.keys(data.songs).length}
  <p class="muted">No practice saved yet. Finish a run on the Practice tab and it shows up here.</p>
{:else}
  {#if data.hardest.length}
    <h3>Hardest changes</h3>
    <ul class="hard">
      {#each data.hardest as h (h.change)}
        <li><button class="btn" onclick={() => practise(h.change)}>{h.change}</button> <span class="muted">{h.accuracy}% over {h.bars} bars — click to loop it</span></li>
      {/each}
    </ul>
  {/if}

  <h3>Songs</h3>
  {#each Object.entries(data.songs) as [id, s] (id)}
    <div class="song">
      <div class="row"><strong>{nameOf(id)}</strong><span class="muted">best {s.best}% · last {s.last}% · {s.history.length} runs</span></div>
      <svg viewBox="0 0 {W} {H}" width="100%" height={H} role="img" aria-label="{nameOf(id)} scores over time">
        <line x1="0" x2={W} y1={H - 5 - (90 * (H - 10)) / 100} y2={H - 5 - (90 * (H - 10)) / 100} class="goal" />
        <polyline points={line(s.history)} class="line" />
        {#each s.history as h, i (i)}
          {@const [cx, cy] = line(s.history).split(' ')[i].split(',')}
          <circle {cx} {cy} r="3" class="dot"><title>{h.score}% at {h.bpm} BPM</title></circle>
        {/each}
      </svg>
    </div>
  {/each}

  <h3>Recent</h3>
  <ul class="recent">
    {#each data.recent as r (r.id)}
      <li>{new Date(r.started * 1000).toLocaleString()} — {nameOf(r.song)} at {r.bpm} BPM: <strong>{r.score}%</strong></li>
    {/each}
  </ul>
{/if}

<style>
  h3 { font-size: .95rem; margin: 20px 0 8px; }
  .hard, .recent { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .hard .btn { padding: 6px 12px; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2; }
  .dot { fill: var(--accent); }
  .goal { stroke: var(--line); stroke-dasharray: 4 4; }
</style>
