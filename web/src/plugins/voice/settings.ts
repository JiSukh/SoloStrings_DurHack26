// The voice plugin's settings: the ElevenLabs key, voice and coach agent id, kept in this
// browser only (never the repo, never the board). This file is loaded with the page; the
// plugin itself (VoicePanel and Ray's voice/eleven/coach modules) is imported only once a key
// is set, so without one the page never downloads or runs any of it.

import { writable } from 'svelte/store';
import { board } from '../../lib/api';

const STORE = 'servo-strummer-elevenlabs';  // same key as the old page, so saved settings carry over

export interface VoiceSettings { key?: string; voice?: string; agent?: string }

function load(): VoiceSettings {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

export const voiceSettings = writable<VoiceSettings>(load());
voiceSettings.subscribe(s => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private window */ } });

export const setVoice = (patch: Partial<VoiceSettings>) => voiceSettings.update(s => ({ ...s, ...patch }));

// A key saved in this browser wins; otherwise take the one in the board's .env.
export async function loadBoardKey() {
  let have = false;
  voiceSettings.subscribe(s => { have = !!s.key; })();
  if (have) return;
  try {
    const key = (await board.config()).elevenlabs_key;
    if (key) setVoice({ key });
  } catch { /* old board or not reachable: the Setup tab asks */ }
}
