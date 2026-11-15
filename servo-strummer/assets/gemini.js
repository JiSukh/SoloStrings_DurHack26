// Gemini from the browser: the chords of a song the page doesn't carry. Like ElevenLabs, the
// key comes from the board's secrets (GET /config) and the call goes from the page straight
// to Google, because the board has no internet.

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-flash-latest';

// What to ask. `known` = the only chord names the strummer can play, show and hear.
export function songPrompt(song, known) {
  return `A beginner wants to learn the song "${song}" on guitar with a strumming robot.
Give its main chord progression (the verse and chorus most people know), one chord per bar of 4/4, 8 to 16 bars.
Use ONLY these chords: ${known.join(', ')}. If the song is in a harder key, transpose it to an easy one and simplify chords (for example F#m7 becomes Em in the new key).
Set "found" to false if you do not know the song or it cannot be played with these chords. Do not include lyrics.`;
}

// -> { title, chords: [...] } as Gemini gave it (the caller checks the chords), or null when
// Gemini doesn't know the song. Throws on a network / key error.
export async function songChords(key, model, song, known) {
  const res = await fetch(`${API}/${model || DEFAULT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: songPrompt(song, known) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            found: { type: 'BOOLEAN' },
            title: { type: 'STRING' },
            chords: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['found', 'title', 'chords'],
        },
      },
    }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ` ${(await res.json()).error.message}`; } catch {}
    throw new Error(`Gemini: ${msg}`);
  }
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let out;
  try { out = JSON.parse(text); } catch { return null; }
  return out && out.found && Array.isArray(out.chords) ? { title: String(out.title || song), chords: out.chords } : null;
}
