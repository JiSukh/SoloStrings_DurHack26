// What a voice (or typed, or coach) command does, as a typed API over the page's actions.
// parseCommand() in voice.js turns words into a Command; runCommand() carries it out and
// returns the reply to show and speak. Nothing here touches the DOM.

import { get } from 'svelte/store';
import { knobIn, server, tempoOf } from '../../lib/api';
import * as page from '../../lib/page';
import { chordHelp, parseCommand, spokenChord } from './voice.js';  // Ray's plain JS (allowJs), verbatim

// The shapes parseCommand() returns (see its comment in voice.js).
export type Command =
  | { action: 'play'; pattern: string | null; bpm?: number }
  | { action: 'stop' }
  | { action: 'tempo'; bpm: number }
  | { action: 'tempo_delta'; delta: number }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'chord'; chord: string }
  | { action: 'song'; chords: string[]; name?: string }
  | { action: 'explain'; chord: string }
  | { action: 'what' }
  | { action: 'help' };

const sayPattern = (name: string) => name.replace(/\(.*?\)/g, '').trim();

export async function runCommand(cmd: Command): Promise<string> {
  const s = get(server), playing = s?.playing || null;
  switch (cmd.action) {
    case 'stop':
      await page.stop();
      return 'Stopping.';
    case 'play': {
      const tempo = cmd.bpm && !knobIn(s) ? ` at ${await page.setTempo(cmd.bpm)}` : '';
      const name = cmd.pattern || get(page.selected) || get(page.patterns)[0];
      const r = await page.play(name);
      if (!r.ok) return `I couldn't start: ${r.error}.`;
      return `${'switched' in r && r.switched ? 'Switching to' : 'Playing'} ${sayPattern(name)}${tempo}.`;
    }
    case 'tempo':
    case 'tempo_delta': {
      if (knobIn(s)) return 'The knob sets the tempo. Turn the knob.';
      return `Tempo ${await page.setTempo(cmd.action === 'tempo' ? cmd.bpm : tempoOf(s) + cmd.delta)}.`;
    }
    case 'next':
    case 'prev': {
      const name = page.stepPattern(cmd.action === 'next' ? 1 : -1);
      if (playing) return runCommand({ action: 'play', pattern: name });
      page.selected.set(name);
      return `${sayPattern(name)} selected. Say play to start.`;
    }
    case 'chord':
      await page.setChord(cmd.chord);
      return cmd.chord ? `Chord ${spokenChord(cmd.chord)}.` : 'All strings.';
    case 'song': {
      const r = await page.loadSong(cmd.chords);
      if (!r.ok) return `I couldn't load that: ${r.error || 'the board needs the updated app'}.`;
      if (!cmd.chords.length) return 'Song cleared.';
      const used = [...new Set(cmd.chords)].map(spokenChord).join(', ');
      return `Loaded ${cmd.name || 'your chords'}. It uses ${used}.${playing ? '' : ' Say play to start.'}`;
    }
    case 'explain':  // spoken fingering, and the dots on the virtual guitar for 15 s
      page.explain(cmd.chord);
      return chordHelp(cmd.chord, get(page.chords)[cmd.chord]);
    case 'what': {
      const c = page.detectedChord() || (s && s.chord);
      return c ? `That's ${spokenChord(c)}.` : "I can't tell yet. Start chord by ear or the chord camera first.";
    }
    case 'help':
      return 'Try: play Travis picking. Stop. Faster. Tempo ninety. Chord A minor. How do I play F. Or twelve bar blues.';
  }
  return "I don't know how to do that.";
}

// The coach agent's client tools: names and parameters match coachTools() in coach.js.
export function coachHandlers(did: (reply: string) => void) {
  const patterns = () => get(page.patterns), chordNames = () => Object.keys(get(page.chords));
  const chordName = (c: unknown) => chordNames().find(n => n.toLowerCase() === String(c ?? '').trim().toLowerCase());
  const told = async (reply: Promise<string>) => { const r = await reply; did(r); return r; };
  return {
    play_pattern: ({ pattern }: { pattern: string }) => {
      const parsed = parseCommand(String(pattern), { patterns: patterns() });
      const name = patterns().find(p => p.toLowerCase() === String(pattern).trim().toLowerCase())
        || (parsed && parsed.action === 'play' ? parsed.pattern : null);
      return name ? told(runCommand({ action: 'play', pattern: name })) : `Unknown pattern. Use one of: ${patterns().join('; ')}`;
    },
    stop_playing: () => told(runCommand({ action: 'stop' })),
    set_tempo: ({ bpm }: { bpm: unknown }) =>
      Number.isFinite(Number(bpm)) ? told(runCommand({ action: 'tempo', bpm: Number(bpm) })) : 'bpm must be a number from 30 to 200',
    set_chord: ({ chord }: { chord: unknown }) => {
      const name = chordName(chord);
      if (String(chord ?? '').trim() && !name) return `Unknown chord. Use one of: ${chordNames().join(', ')}`;
      return told(runCommand({ action: 'chord', chord: name || '' }));
    },
    load_song: ({ chords }: { chords: unknown }) => {
      const asked = String(chords ?? '').split(/[,\s]+/).filter(Boolean), names = asked.map(chordName);
      const bad = asked.filter((_, i) => !names[i]);
      if (bad.length) return `Unknown chords: ${bad.join(', ')}. Only use: ${chordNames().join(', ')}`;
      return told(runCommand({ action: 'song', chords: names as string[], name: 'the song' }));
    },
    get_state: () => {
      const s = get(server);
      return JSON.stringify({ playing: s?.playing || null, tempo: tempoOf(s), song: s?.song || null,
                              chosen_chord: s?.chord || null, detected_chord: page.detectedChord() });
    },
  };
}

