<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { connected, server } from './lib/api';
  import { start } from './lib/page';
  import Calibration from './lib/components/Calibration.svelte';
  import Chords from './lib/components/Chords.svelte';
  import DebugToggle from './lib/components/DebugToggle.svelte';
  import MicListener from './lib/components/MicListener.svelte';
  import NowBar from './lib/components/NowBar.svelte';
  import Patterns from './lib/components/Patterns.svelte';
  import StringTest from './lib/components/StringTest.svelte';
  import Tempo from './lib/components/Tempo.svelte';
  import VirtualGuitar from './lib/components/VirtualGuitar.svelte';
  import { loadBoardKey, setVoice, voiceSettings } from './plugins/voice/settings';
  import Practice from './components/Practice/Practice.svelte';
  import Progress from './components/Progress/Progress.svelte';
  import { practiceRequested } from './lib/practice/session';

  type Tab = 'play' | 'practice' | 'progress' | 'setup' | 'voice';
  const TABS: [Tab, string][] = [['play', 'Play'], ['practice', 'Practice'], ['progress', 'Progress'], ['setup', 'Setup'], ['voice', 'Voice']];
  let tab = $state<Tab>('play');
  let failed = $state('');

  // Optional parts, imported only when wanted: the camera (needs internet for MediaPipe) and the
  // voice plugin (only with an ElevenLabs key). Neither is in the main bundle.
  let Camera = $state<Component | null>(null), cameraLoading = $state(false);
  async function showCamera() {
    cameraLoading = true;
    Camera = (await import('./lib/components/CameraRecogniser.svelte')).default;
  }
  let VoicePanel = $state<Component | null>(null);
  const voiceOn = $derived(!!$voiceSettings.key);
  $effect(() => {
    if (voiceOn && !VoicePanel) import('./plugins/voice/VoicePanel.svelte').then(m => { VoicePanel = m.default; });
  });
  $effect(() => { if (!voiceOn && tab === 'voice') tab = 'setup'; });
  // the Progress view started a practice loop
  $effect(() => { if ($practiceRequested) tab = 'practice'; });

  let keyInput = $state('');
  $effect(() => { keyInput = $voiceSettings.key || ''; });

  onMount(() => {
    start().catch(() => { failed = 'Board not reachable'; });
    loadBoardKey();
  });
</script>

<main>
  <header class="row">
    <h1>Servo Strummer</h1>
    {#if $server && !$server.servos}<span class="badge">debug mode: servos off</span>{/if}
    {#if !$connected}<span class="badge off">{failed || 'connecting…'}</span>{/if}
  </header>

  <nav class="tabs" aria-label="Sections">
    {#each TABS as [id, label] (id)}
      {#if id !== 'voice' || voiceOn}
        <button aria-pressed={tab === id} onclick={() => (tab = id)}>{label}</button>
      {/if}
    {/each}
  </nav>

  <section hidden={tab !== 'play'}>
    <NowBar />
    <VirtualGuitar />
    <Patterns />
    <Tempo />
    <Chords />
    <MicListener />
    <h2>Chord camera (left hand) <small class="muted">Experimental, needs internet</small></h2>
    {#if Camera}
      <Camera />
    {:else}
      <button class="btn" disabled={cameraLoading} onclick={showCamera}>Show chord camera</button>
    {/if}
  </section>

  <section hidden={tab !== 'practice'}>
    <Practice />
  </section>

  <section hidden={tab !== 'progress'}>
    <Progress visible={tab === 'progress'} />
  </section>

  <section hidden={tab !== 'setup'}>
    <DebugToggle />
    <StringTest />
    <Calibration />
    <h2>Voice plugin (ElevenLabs)</h2>
    <p class="muted">Paste an ElevenLabs API key to turn on voice control and the coach (needs internet). It is kept in this browser only.</p>
    <div class="row">
      <input type="password" bind:value={keyInput} placeholder="ElevenLabs API key" autocomplete="off" aria-label="ElevenLabs API key">
      <button class="btn" onclick={() => setVoice({ key: keyInput.trim() })}>Save</button>
    </div>
  </section>

  <!-- mounted (but hidden) on every tab once loaded, so chord call-outs and space-to-talk keep working -->
  {#if voiceOn && VoicePanel}
    <section hidden={tab !== 'voice'}><VoicePanel /></section>
  {/if}
</main>

<style>
  header { margin-bottom: 12px; }
  .badge { font-size: .8rem; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); }
  .badge.off { border-color: var(--muted); color: var(--muted); }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; border-bottom: 1px solid var(--line); padding-bottom: 10px; }
  .tabs button { padding: 8px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--fg); font: inherit; cursor: pointer; }
  h2 small { font-weight: 400; margin-left: 6px; }
</style>
