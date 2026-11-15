// Coach conversation (experimental): an ElevenLabs agent you talk to freely. It can ask the
// strummer to do things through "client tools", which are functions on this page. The agent
// and its tools are created once in your ElevenLabs account, straight from this page.

const API = 'https://api.elevenlabs.io';
const SDK = 'https://esm.sh/@elevenlabs/client@1.36.1';

const str = description => ({ type: 'string', description });

// name, description, parameters: must match the handlers the page passes to startCoach().
export function coachTools(patterns, chords) {
  const tool = (name, description, properties = {}, required = Object.keys(properties)) =>
    ({ name, description, parameters: { type: 'object', properties, required } });
  return [
    tool('play_pattern', 'Start the robot strumming or picking, or switch to another pattern at the next bar.',
      { pattern: str(`Exactly one of: ${patterns.join('; ')}`) }),
    tool('stop_playing', 'Stop the robot at the end of the current bar.'),
    tool('set_tempo', 'Set the tempo.', { bpm: { type: 'integer', description: 'Beats per minute, 30 to 200' } }),
    tool('set_chord', 'Tell the robot which chord the player is holding, so it skips the strings that chord mutes.',
      { chord: str(`One of: ${chords.join(', ')}. Empty string for all strings.`) }),
    tool('load_song', 'Load a chord progression, one chord per bar, that loops while the robot plays. Use it to teach a song.',
      { chords: str(`Comma-separated chords, one per bar, only from: ${chords.join(', ')}. Empty string clears the song.`) }),
    tool('get_state', 'What is playing now, the tempo, the loaded song, and the chord the camera or microphone detects.'),
  ];
}

export function coachPrompt(patterns, chords) {
  return `You are a friendly guitar coach built into a robot that strums and picks a guitar for someone who plays with one hand. The player frets the chords; the robot does the picking hand.

You control the robot only through your tools. Call a tool whenever the player asks for something the robot can do, then confirm in a few words.

Rules:
- Keep every reply to one short sentence. The guitar is loud and the player's hand is busy.
- Chords the robot knows: ${chords.join(', ')}. Never use any other chord. If a song needs one, transpose the song or pick the nearest chord from the list, and say so.
- Patterns the robot knows: ${patterns.join('; ')}.
- To teach a song: work out its chord progression from memory, one chord per bar, call load_song, choose a fitting pattern and a slow tempo, and tell the player the chords in order. You may be slightly wrong about a song's chords: say it is your best guess.
- Never recite or sing song lyrics.
- If you did not understand, ask the player to repeat it.`;
}

async function post(key, path, body) {
  const res = await fetch(API + path, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(`${path}: ${res.status} ${typeof d === 'string' ? d : d?.message || d?.[0]?.msg || JSON.stringify(d || data)}`);
  }
  return data;
}

// Creates the tools and the agent in the ElevenLabs account; returns the agent id.
export async function createCoach(key, { voice, patterns, chords }) {
  const toolIds = [];
  for (const t of coachTools(patterns, chords)) {
    const made = await post(key, '/v1/convai/tools', {
      tool_config: { type: 'client', name: t.name, description: t.description, parameters: t.parameters,
        expects_response: true, response_timeout_secs: 10 },
    });
    toolIds.push(made.id);
  }
  const agent = await post(key, '/v1/convai/agents/create', {
    name: 'Guitar strummer coach',
    conversation_config: {
      agent: {
        first_message: 'Ready when you are. What shall we play?',
        language: 'en',
        prompt: { prompt: coachPrompt(patterns, chords), llm: 'gemini-2.5-flash', tool_ids: toolIds },
      },
      tts: { voice_id: voice },
    },
  });
  return agent.agent_id;
}

// Starts a conversation. handlers = { tool_name: async params => string }.
// on = { message(text, who), status(text), error(text) }. Returns the session (endSession()).
export async function startCoach({ key, agentId, handlers, on }) {
  const { Conversation } = await import(SDK);
  let who = { agentId };
  if (key) {  // a signed URL works for private agents too; fall back to the public id
    try {
      const res = await fetch(`${API}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
        { headers: { 'xi-api-key': key } });
      if (res.ok) who = { signedUrl: (await res.json()).signed_url };
    } catch {}
  }
  return Conversation.startSession({
    ...who,
    connectionType: 'websocket',
    clientTools: handlers,
    onMessage: m => on.message(m?.message ?? m?.text ?? JSON.stringify(m), m?.source || m?.role || ''),
    onStatusChange: s => on.status(s?.status ?? String(s)),
    onModeChange: m => on.status(m?.mode === 'speaking' ? 'coach speaking' : 'listening'),
    onError: e => on.error(e?.message ?? String(e)),
    onDisconnect: () => on.status('disconnected'),
  });
}
