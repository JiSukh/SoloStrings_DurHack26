// ElevenLabs from the browser: speech-to-text for commands, text-to-speech for replies, and
// the microphone handling around them. The key comes from the board's secrets (GET /config);
// the board has no internet, so every call goes from the page straight to api.elevenlabs.io.

const API = 'https://api.elevenlabs.io';
const STT_MODEL = 'scribe_v2';
const TTS_MODEL = 'eleven_flash_v2_5';  // the low-latency model: replies start in well under a second
export const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

async function fail(res, what) {
  let msg = `${res.status}`;
  try {
    const d = (await res.json()).detail;
    msg += ` ${typeof d === 'string' ? d : d?.message || d?.[0]?.msg || JSON.stringify(d)}`;
  } catch {}
  if (res.status === 401) msg = 'key rejected (401): check the ElevenLabs API key';
  throw new Error(`${what}: ${msg}`);
}

// ---------- speech to text ----------
let keytermsOk = true;  // turned off for the session if the API rejects the field

export async function transcribe(key, blob, keyterms = []) {
  const send = async withTerms => {
    const fd = new FormData();
    fd.append('model_id', STT_MODEL);
    fd.append('file', blob, 'speech.webm');
    fd.append('language_code', 'en');
    fd.append('tag_audio_events', 'false');  // no "(guitar strumming)" in the text
    if (withTerms) for (const k of keyterms) fd.append('keyterms', k);
    return fetch(`${API}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  };
  let res = await send(keytermsOk && keyterms.length > 0);
  if (!res.ok && (res.status === 400 || res.status === 422) && keytermsOk && keyterms.length) {
    keytermsOk = false;  // keyterms need a paid plan / newer model: carry on without them
    res = await send(false);
  }
  if (!res.ok) await fail(res, 'speech-to-text');
  return ((await res.json()).text || '').trim();
}

// ---------- text to speech ----------
// Clips are kept in memory and in the browser's cache, so each phrase (chord names above all)
// is paid for once and then plays with no delay, even with the venue Wi-Fi down.
const clips = new Map();
const cacheKey = (voice, text) => `https://tts.invalid/${TTS_MODEL}/${voice}/${encodeURIComponent(text)}`;

export async function tts(key, voice, text) {
  const id = cacheKey(voice, text);
  if (clips.has(id)) return clips.get(id);
  const make = (async () => {
    let store = null;
    try { store = await caches.open('servo-strummer-tts-v1'); } catch {}
    let res = store && await store.match(id);
    if (!res) {
      res = await fetch(`${API}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
      });
      if (!res.ok) await fail(res, 'text-to-speech');
      if (store) { try { await store.put(id, res.clone()); } catch {} }
    }
    return URL.createObjectURL(await res.blob());
  })();
  clips.set(id, make);
  make.catch(() => clips.delete(id));  // a failed clip can be tried again
  return make;
}

export async function voices(key) {
  const res = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) await fail(res, 'voices');
  return ((await res.json()).voices || []).map(v => ({ id: v.voice_id, name: v.name }));
}

// One clip at a time; a new one cuts off the old (the newest thing said matters most).
export class Speaker {
  constructor() {
    this.el = new Audio();
    this.speaking = false;
    this.turn = 0;
    const done = () => { const t = this.turn; setTimeout(() => { if (t === this.turn) this.speaking = false; }, 250); };  // let the room echo die
    this.el.onended = done; this.el.onerror = done;
  }
  async play(url) {
    this.turn++;
    this.el.src = url;
    this.speaking = true;
    try { await this.el.play(); } catch (e) { this.speaking = false; throw e; }
  }
}

// ---------- microphone ----------
// A second microphone stream, separate from the chord-by-ear one: that one switches the
// browser's voice processing off to keep the notes; this one wants it on, to cut the room
// and the guitar down and keep the voice.
export class VoiceMic {
  constructor() { this.stream = null; this.rec = null; this.chunks = []; this.startedAt = 0; this.analyser = null; }

  async open() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  level() {  // loudness right now, 0..1 (RMS)
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const x of this.buf) sum += x * x;
    return Math.sqrt(sum / this.buf.length);
  }

  get recording() { return !!this.rec; }

  start() {
    if (this.rec || !this.stream) return;
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    this.rec.start();
  }

  // Stops and returns { blob, ms }, or null if nothing was being recorded.
  stop() {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    const ms = performance.now() - this.startedAt;
    return new Promise(resolve => {
      rec.onstop = () => resolve({ blob: new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }), ms });
      rec.stop();
    });
  }
}
