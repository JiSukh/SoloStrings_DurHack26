<script lang="ts">
  import { board, server } from '../api';
  import { chords, setChord } from '../page';
</script>

<h2>Chord</h2>
<div class="chips" role="group" aria-label="Chord">
  <button aria-pressed={!$server?.chord} title="Every string" onclick={() => setChord('')}>All</button>
  {#each Object.entries($chords) as [name, shape] (name)}
    <button aria-pressed={$server?.chord === name} title={shape} onclick={() => setChord(name)}>{name}</button>
  {/each}
</div>
{#if $server?.song}
  <div class="row song">
    <span>Song: <strong>{$server.song.join(' → ')}</strong></span>
    <button class="btn" onclick={() => board.song([])}>Clear song</button>
  </div>
{/if}

<style>
  .song { margin-top: 10px; }
</style>
