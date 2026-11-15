<script lang="ts">
  // Ray's voice control and coach conversation, as a plugin: App.svelte imports this only when
  // an ElevenLabs key is set. Speech maths in voice.js, ElevenLabs calls in eleven.js, the coach
  // agent in coach.js (all three verbatim); what a command does is in commands.ts.
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { chords, onBar, patterns } from '../../lib/page';
  import type { CoachSession } from './coach.js';
  import { coachHandlers, runCommand } from './commands';
  import { DEFAULT_VOICE, Speaker, SpeechGate, transcribe, tts, VoiceMic, voices, type Clip } from './eleven.js';
  import { keyterms, parseCommand, spokenChord, stripWake } from './voice.js';
  import { setVoice, voiceSettings } from './settings';

  const speaker = new Speaker(), mic = new VoiceMic(), gate = new SpeechGate();
  const key = () => get(voiceSettings).key || '';
  const voiceId = () => get(voiceSettings).voice || DEFAULT_VOICE;
  const chordNames = () => Object.keys(get(chords));

  let heardText = $state('–'), didText = $state('–'), didBad = $state(false);
  let live = $state(false), handsFree = $state(false), speakReplies = $state(true), callouts = $state(true);
  let level = $state(0), sensitivity = $state(3), typed = $state('');
  let voiceList = $state<{ id: string; name: string }[]>([]);
  let coachStatus = $state('not connected'), coachSaid = $state('–'), coachBusy = $state(false), creating = $state(false);
  let coach: CoachSession | null = null;
  let coachLive = $state(false);
  let holding = false, busy = false;

  const did = (text: string, bad = false) => { didText = text; didBad = bad; };

  async function speak(text: string) {  // out loud if there's a key; never throws
    if (!key() || !text) return;
    try { await speaker.play(await tts(key(), voiceId(), text)); } catch (e) { did((e as Error).message, true); }
  }

  // Say the next bar's chord about a beat before the bar line, whenever the chord changes.
  // The clip is fetched as the bar starts (and cached), so it's ready when its moment comes.
  const offBar = onBar((chord, next, barEndAt, beatMs) => {
    if (!callouts || !key() || !next || next === chord) return;
    const lead = Math.max(beatMs, 700) + 150;  // a chord name takes about 0.7 s to say
    tts(key(), voiceId(), spokenChord(next)).then(url => {
      const wait = barEndAt - lead - performance.now();
      if (wait < -400) return;  // arrived too late to help
      setTimeout(() => speaker.play(url).catch(() => {}), Math.max(0, wait));
    }).catch(e => did(e.message, true));
  });

  // Text (heard or typed) -> command -> action -> reply shown and spoken.
  async function act(text: string, wake = false) {
    heardText = text || '(nothing)';
    let said: string | null = text;
    if (wake) { said = stripWake(text); if (said === null) return; }  // someone else's chatter
    const cmd = parseCommand(said, { patterns: get(patterns), chords: chordNames() });
    if (!cmd) return did(said ? 'Not a command I know. Say “help” for examples.' : 'Yes?');
    const reply = await runCommand(cmd);
    did(reply);
    if (speakReplies) speak(reply);
  }

  // One recorded clip -> text -> command -> action -> reply.
  async function heard(clip: Clip | null, wake: boolean) {
    if (!clip || clip.ms < 300 || busy) return;
    busy = true;
    try {
      heardText = '…';
      await act(await transcribe(key(), clip.blob, keyterms(get(patterns), chordNames())), wake);
    } catch (e) { did((e as Error).message, true); } finally { busy = false; }
  }

  function typedKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !typed.trim()) return;
    act(typed).catch(err => did(err.message, true));
    typed = '';
  }

  async function openMic() {
    if (!key()) { did('Set your ElevenLabs API key on the Setup tab first.', true); return false; }
    try { await mic.open(); return true; } catch (e) {
      did(window.isSecureContext ? `mic error: ${(e as Error).message}` : 'the mic needs http://localhost (use open.sh)', true);
      return false;
    }
  }

  // Hold to talk: the button, or the space bar anywhere outside a text box.
  async function talkStart() {
    if (holding) return;
    holding = true;
    if (!await openMic() || !holding) return;  // let go while the mic prompt was open
    mic.start();
    live = true;
  }
  async function talkEnd() {
    if (!holding) return;
    holding = false;
    live = false;
    heard(await mic.stop(), false);
  }
  const typing = (e: KeyboardEvent) => /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
  const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); if (!e.repeat) talkStart(); } };
  const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); talkEnd(); } };

  async function toggleHandsFree() { if (handsFree && !await openMic()) handsFree = false; }

  // Hands-free: record whenever a voice rises above the room, act only if it starts with "guitar".
  const meter = setInterval(() => {
    if (!mic.stream) return;
    level = mic.level();
    if (!handsFree || holding || coach) return;
    if ((speaker.speaking || busy) && !gate.open) return;  // don't answer our own voice
    const ev = gate.tick(level, Number(sensitivity));
    if (ev === 'start') mic.start();
    else if (ev === 'end') mic.stop().then(clip => heard(clip, true));
  }, 50);

  async function loadVoices() {
    if (!key()) return;
    try {
      voiceList = await voices(key());
      did('ElevenLabs key works.');
    } catch (e) { did((e as Error).message, true); }
  }

  function pickVoice(e: Event) {
    setVoice({ voice: (e.currentTarget as HTMLSelectElement).value });
    speak('Hello. This is my voice.');
  }

  // ---------- coach conversation (experimental; agent set-up in coach.js) ----------
  async function createCoachAgent() {
    if (!key()) { coachStatus = 'Set your ElevenLabs API key on the Setup tab first.'; return; }
    creating = true;
    coachStatus = 'creating the coach in your ElevenLabs account…';
    try {
      const { createCoach } = await import('./coach.js');
      setVoice({ agent: await createCoach(key(), { voice: voiceId(), patterns: get(patterns), chords: chordNames() }) });
      coachStatus = 'coach created: press Start conversation';
    } catch (e) { coachStatus = `couldn't create it: ${(e as Error).message}`; } finally { creating = false; }
  }
  const coachEnded = () => { coach = null; coachLive = false; };
  async function toggleCoach() {
    if (coach) { const c = coach; coachEnded(); try { await c.endSession(); } catch { /* gone already */ } coachStatus = 'not connected'; return; }
    const agentId = ($voiceSettings.agent || '').trim();
    if (!agentId) { coachStatus = 'Press Create coach first, or paste an agent ID.'; return; }
    handsFree = false;  // one listener at a time
    coachBusy = true;
    coachStatus = 'connecting…';
    try {
      const { startCoach } = await import('./coach.js');
      coach = await startCoach({ key: key(), agentId, handlers: coachHandlers(did), on: {
        message: (text: string, who: string) => { coachSaid = `${who === 'user' ? 'You' : 'Coach'}: ${text}`; },
        status: (t: string) => { coachStatus = t; if (t === 'disconnected') coachEnded(); },
        error: (t: string) => { coachStatus = `error: ${t}`; },
      } });
      coachLive = true;
    } catch (e) { coachEnded(); coachStatus = `couldn't start: ${(e as Error).message}`; } finally { coachBusy = false; }
  }

  // the voice list, now and whenever the key changes on the Setup tab
  $effect(() => { if ($voiceSettings.key) loadVoices(); });

  onMount(() => {
    addEventListener('keydown', down);
    addEventListener('keyup', up);
  });
  onDestroy(() => {
    removeEventListener('keydown', down);
    removeEventListener('keyup', up);
    clearInterval(meter);
    offBar();
    coach?.endSession().catch(() => {});
  });
</script>

<h2>Voice control (ElevenLabs)</h2>
<p class="muted">Hold the button (or the space bar) and speak, then let go. Try “play Travis picking”, “stop”, “faster”, “tempo ninety”, “chord A minor”, “how do I play F”, “twelve bar blues” or “chords G, D, E minor, C”.</p>
<div class="row gap">
  <select aria-label="Voice" value={$voiceSettings.voice || ''} onchange={pickVoice}>
    <option value="">Default voice</option>
    {#each voiceList as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
  </select>
</div>
<div class="row">
  <button class="btn primary" class:live
          onpointerdown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); talkStart(); }}
          onpointerup={talkEnd} onpointercancel={talkEnd}>{live ? 'Listening…' : 'Hold to talk'}</button>
  <label><input type="checkbox" bind:checked={handsFree} onchange={toggleHandsFree}> Hands-free: say “guitar” first</label>
</div>
<div class="row gap-top">
  <label><input type="checkbox" bind:checked={speakReplies}> Speak replies</label>
  <label><input type="checkbox" bind:checked={callouts}> Call out the next chord</label>
</div>
<div class="row gap-top">
  <span class="muted">Mic</span>
  <meter min="0" max="0.3" value={level} aria-label="Voice microphone level"></meter>
  <label class="muted">Hands-free sensitivity
    <input type="range" min="1.5" max="8" step="0.5" bind:value={sensitivity} aria-label="How far above the room noise a voice must be" class="small">
  </label>
</div>
<div class="row gap-top">
  <input type="text" bind:value={typed} onkeydown={typedKey} placeholder="Too loud to talk? Type a command and press Enter" autocomplete="off" aria-label="Type a command">
</div>
<div class="log" role="status">
  <p><span class="muted">Heard:</span> {heardText}</p>
  <p><span class="muted">Did:</span> <strong class:err={didBad}>{didText}</strong></p>
</div>

<h2>Coach conversation (experimental)</h2>
<p class="muted">Talk freely with an ElevenLabs agent: “teach me a slow song in G”, “make it faster”. It listens all the time, so it works best with a headset in a quiet spot. “Create coach” sets it up once in your ElevenLabs account.</p>
<div class="row">
  <input type="text" value={$voiceSettings.agent || ''} onchange={e => setVoice({ agent: e.currentTarget.value.trim() })}
         placeholder="Agent ID (filled in by Create coach)" autocomplete="off" aria-label="ElevenLabs agent ID">
  <button class="btn" disabled={creating} onclick={createCoachAgent}>Create coach</button>
  <button class="btn primary" disabled={coachBusy} onclick={toggleCoach}>{coachLive ? 'End conversation' : 'Start conversation'}</button>
</div>
<div class="log" role="status">
  <p><span class="muted">Status:</span> {coachStatus}</p>
  <p>{coachSaid}</p>
</div>

<style>
  .gap { margin-bottom: 10px; }
  .gap-top { margin-top: 10px; }
  meter { flex: 1; min-width: 120px; }
  .small { min-width: 100px; flex: 0 1 120px; }
  .live { background: var(--ok) !important; border-color: var(--ok) !important; }
</style>
