<script lang="ts">
  import { onMount } from 'svelte';
  import { knobIn, server } from '../../lib/api';
  import { chords } from '../../lib/page';
  import { songs as loadSongs, type SongInfo } from '../../lib/practice/api';
  import { suggestTempo } from '../../lib/practice/grade';
  import { run, start, stop } from '../../lib/practice/session';
  import ChordDiagram from './ChordDiagram.svelte';

  let songs = $state<SongInfo[]>([]);
  let songId = $state('');
  let bpm = $state(90);
  const song = $derived(songs.find(s => s.id === songId) || null);

  onMount(async () => {
    songs = await loadSongs().catch(() => []);
    if (songs.length && !songId) { songId = songs[0].id; bpm = songs[0].bpm; }
  });
  // a loop started from the Progress view isn't in the list: show it as the current choice
  $effect(() => {
    const s = $run.song;
    if (s && !songs.some(x => x.id === s.id)) { songs = [...songs, s]; songId = s.id; bpm = $run.bpm; }
  });

  const playing = $derived($run.phase === 'count-in' || $run.phase === 'playing');
  const now = $derived($run.bars.length ? $run.bars[$run.bars.length - 1] : null);
  const suggestion = $derived($run.summary ? suggestTempo($run.summary.score, $run.bpm) : null);
  const LABEL = { hit: 'hit', late: 'late', miss: 'miss', silent: 'no sound' } as const;
</script>

<h2>Practice</h2>
<p class="muted">Pick a song and fret the chords while the robot plays. The microphone grades every bar: <span class="key hit">hit</span> <span class="key late">late</span> <span class="key miss">miss</span> <span class="key silent">no sound</span>. To test without a guitar: debug mode on, virtual guitar sound on, and the laptop hears itself.</p>

<div class="row">
  <select bind:value={songId} aria-label="Song" disabled={playing}
          onchange={() => { if (song) bpm = song.bpm; }}>
    {#each songs as s (s.id)}<option value={s.id}>{s.name} ({s.chords.join(' ')})</option>{/each}
  </select>
  <label>Tempo <input type="number" min="30" max="200" bind:value={bpm} disabled={playing} class="bpm"> BPM</label>
  {#if playing}
    <button class="btn" onclick={stop}>Stop</button>
  {:else}
    <button class="btn primary" disabled={!song} onclick={() => song && start(song, bpm)}>Start</button>
  {/if}
</div>
{#if knobIn($server)}<p class="muted">The knob is plugged in, so it sets the tempo.</p>{/if}
{#if $run.phase === 'error'}<p class="err">{$run.error}</p>{/if}

{#if $run.phase === 'count-in'}
  <p class="count" aria-live="assertive">{$run.countIn || 'Go'}</p>
{/if}

{#if playing && now}
  <div class="row diagrams">
    <div><small class="muted">Now</small><ChordDiagram name={now.chord} shape={$chords[now.chord] ?? null} size={1.5} /></div>
    {#if now.next}<div class="next"><small class="muted">Next</small><ChordDiagram name={now.next} shape={$chords[now.next] ?? null} /></div>{/if}
  </div>
{/if}

{#if $run.total}
  <ol class="timeline" aria-label="Bars">
    {#each Array.from({ length: $run.total }, (_, i) => $run.bars[i]) as b, i (i)}
      <li class={b?.grade ?? (b ? 'now' : '')} title={b ? `${b.chord}: ${b.grade ? LABEL[b.grade] : 'playing'}` : ''}>{b?.chord ?? ''}</li>
    {/each}
  </ol>
{/if}

{#if $run.phase === 'done' && $run.summary}
  <div class="log">
    <p><strong class="score">{$run.summary.score}%</strong> at {$run.bpm} BPM {$run.saved ? '(saved)' : ''}</p>
    {#if suggestion !== null && suggestion !== $run.bpm}
      <p>{suggestion > $run.bpm ? 'Nice: try it faster.' : 'Slow it down a little.'}
        <button class="btn" onclick={() => { bpm = suggestion; if (song) start(song, suggestion); }}>Again at {suggestion} BPM</button></p>
    {:else}
      <button class="btn" onclick={() => song && start(song, bpm)}>Again</button>
    {/if}
    <p class="muted">Chords: {Object.entries($run.summary.chords).map(([c, a]) => `${c} ${a.accuracy}%`).join(' · ')}</p>
    {#if Object.keys($run.summary.changes).length}
      <p class="muted">Changes: {Object.entries($run.summary.changes).map(([c, a]) => `${c} ${a.accuracy}%`).join(' · ')}</p>
    {/if}
  </div>
{/if}

<style>
  .bpm { width: 5em; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); font: inherit; }
  .count { font-size: 4rem; font-weight: 800; text-align: center; margin: 16px 0; color: var(--accent); }
  .diagrams { margin-top: 16px; align-items: flex-end; gap: 32px; }
  .next { opacity: .75; }
  .timeline { list-style: none; padding: 0; margin: 16px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 4px; }
  .timeline li { height: 40px; border-radius: 6px; border: 1px solid var(--line); display: grid; place-items: center; font-size: .85rem; font-weight: 600; }
  .hit, .key.hit { background: #2b8a3e; color: #fff; }
  .late, .key.late { background: #f59f00; color: #000; }
  .miss, .key.miss { background: #e03131; color: #fff; }
  .silent, .key.silent { background: #868e96; color: #fff; }
  .now { outline: 2px solid var(--accent); }
  .key { padding: 1px 6px; border-radius: 4px; font-size: .8rem; }
  .score { font-size: 2rem; }
</style>
