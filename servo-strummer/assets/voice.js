// Voice control: turning what was heard into a command, and chords into words to speak.
// Pure functions (no DOM, no network), so tests can run them in Node.

// ---------- chords as speech ----------
const QUALITY_SPOKEN = { '': ' major', m: ' minor', 7: ' seven', maj7: ' major seven', add9: ' add nine', sus2: ' sus two', sus4: ' sus four' };
const STRING_SPOKEN = ['Low E', 'A', 'D', 'G', 'B', 'High E'];

// "Am" -> "A minor". Plain majors get "major" too: single letters are hard to tell apart in a
// noisy room, and a lone "A" is read as the word "a".
export function spokenChord(name) {
  const m = /^([A-G])(.*)$/.exec(name || '');
  if (!m) return 'all strings';
  const q = QUALITY_SPOKEN[m[2]];
  return m[1] + (q === undefined ? ` ${m[2]}` : q);
}

// Spoken fingering for a shape like "x02210", low E first.
export function chordHelp(name, shape) {
  const parts = [...shape].map((c, s) =>
    `${STRING_SPOKEN[s]} string: ${c === 'x' ? 'not played' : c === '0' ? 'open' : `fret ${c}`}.`);
  return `${spokenChord(name)}. ${parts.join(' ')}`;
}

// ---------- text clean-up ----------
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNum = w => w in UNITS || w in TENS;

// "one hundred and twenty" -> "120", "ninety five" -> "95", "one twenty" -> "120"
function numberWords(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isNum(tokens[i]) && !(tokens[i] === 'hundred' && !/^\d+$/.test(out[out.length - 1] || ''))) { out.push(tokens[i]); continue; }
    let j = i;
    const small = () => {
      if (tokens[j] in TENS) {
        let v = TENS[tokens[j++]];
        if (tokens[j] in UNITS && UNITS[tokens[j]] >= 1 && UNITS[tokens[j]] <= 9) v += UNITS[tokens[j++]];
        return v;
      }
      return UNITS[tokens[j++]];
    };
    let n = tokens[j] === 'hundred' ? 1 : small();
    if (tokens[j] === 'hundred') {
      j++; n *= 100;
      if (tokens[j] === 'and' && isNum(tokens[j + 1])) j++;
      if (isNum(tokens[j])) n += small();
    } else if (n >= 1 && n <= 2 && tokens[j] in TENS) {
      n = n * 100 + small();
    }
    out.push(String(n));
    i = j - 1;
  }
  return out;
}

// Lower case, no punctuation, no "(guitar strumming)" tags, numbers as digits.
export function normalise(text) {
  let t = (text || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(/\bsuperhuman\b/g, 'super human').replace(/\bfinger style\b/g, 'fingerstyle')
    .replace(/\bboomchick\b/g, 'boom chick').replace(/\b(eights|8ths|eighth notes|8th notes)\b/g, 'eighths')
    .replace(/\bbeats per minute\b|\bb p m\b/g, 'bpm').replace(/\bdoo wop\b/g, 'doowop');
  return numberWords(t.split(/\s+/).filter(Boolean)).join(' ');
}

// Hands-free mode only acts on speech that starts with a wake word. Returns the rest of the
// sentence ('' if only the wake word was said), or null when there was no wake word.
export function stripWake(text, wake = ['guitar', 'robot']) {
  const tokens = normalise(text).split(' ').filter(Boolean);
  const at = tokens.slice(0, 4).findIndex(w => wake.includes(w));
  return at < 0 ? null : tokens.slice(at + 1).join(' ');
}

// ---------- chords in speech ----------
// Letter names as speech-to-text sometimes spells them; only trusted inside a chord list.
const HOMOPHONES = { see: 'c', sea: 'c', gee: 'g', dee: 'd', bee: 'b', be: 'b', eff: 'f', ay: 'a' };

// Every chord named in `tokens`, in order: [{ chord, bare }]. bare = just a letter, which for
// "a" is usually the word, not the chord. loose = also accept spelled-out letter names.
function chordsIn(tokens, names, loose = false) {
  const byLower = Object.fromEntries(names.map(n => [n.toLowerCase(), n]));
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (w.length > 1 && byLower[w]) {  // written as one word: "am", "e7", "fmaj7", "cadd9"
      const pronoun = w === 'am' && (['i', 'what', 'how'].includes(tokens[i - 1]) || tokens[i + 1] === 'i');
      if (!pronoun) out.push({ chord: byLower[w], bare: false });
      continue;
    }
    const root = /^[a-g]$/.test(w) ? w : loose ? HOMOPHONES[w] : null;
    if (!root) continue;
    let q = '', j = i + 1, bare = true;
    const t = k => tokens[k];
    if (t(j) === 'sharp' || t(j) === 'flat') { i = j; continue; }  // no such shapes in the chord list
    if (['minor', 'min', 'm'].includes(t(j))) { q = 'm'; j++; }
    else if (t(j) === 'major' || t(j) === 'maj') { j++; bare = false; if (t(j) === '7' || t(j) === 'seventh') { q = 'maj7'; j++; } }
    else if (t(j) === 'maj7') { q = 'maj7'; j++; }
    else if (t(j) === 'dominant' && (t(j + 1) === '7' || t(j + 1) === 'seventh')) { q = '7'; j += 2; }
    else if (t(j) === '7' || t(j) === 'seventh') { q = '7'; j++; }
    else if (t(j) === 'add' && t(j + 1) === '9') { q = 'add9'; j += 2; }
    else if (t(j) === 'add9') { q = 'add9'; j++; }
    else if ((t(j) === 'sus' || t(j) === 'suspended') && (t(j + 1) === '2' || t(j + 1) === '4')) { q = `sus${t(j + 1)}`; j += 2; }
    else if (t(j) === 'sus2' || t(j) === 'sus4') { q = t(j); j++; }
    const name = byLower[root + q];
    if (name) out.push({ chord: name, bare: bare && q === '' });
    i = j - 1;
  }
  return out;
}

// The one chord a sentence is about: the last one named, ignoring a lone "a" if another is there.
function pickChord(tokens, names) {
  const found = chordsIn(tokens, names);
  const solid = found.filter(c => !(c.bare && c.chord === 'A'));
  const pick = (solid.length ? solid : found).pop();
  return pick ? pick.chord : null;
}

// ---------- patterns in speech ----------
// The words that identify a pattern: "Rock eighths (bass + chop)" -> ["rock", "eighths"]
export function patternWords(name) {
  return name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}
const WEAK_FIRST = new Set(['down', 'up']);  // ordinary words: need a second word to count

function matchPattern(tokens, patterns) {
  const said = new Set(tokens);
  let best = null;
  for (const name of patterns) {
    const words = patternWords(name);
    if (!words.length || !said.has(words[0])) continue;  // its first word must be said
    const hit = words.filter(w => said.has(w)).length, miss = words.length - hit;
    if (WEAK_FIRST.has(words[0]) && hit < 2) continue;
    if (!best || hit > best.hit || (hit === best.hit && miss < best.miss)) best = { name, hit, miss };
  }
  return best ? best.name : null;
}

// Chord progressions you can ask for by name; every chord is in the strummer's chord list.
export const SONGS = [
  { name: 'twelve bar blues', match: /\b12 bar\b|\bblues\b/, chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'] },
  { name: 'the four chord song', match: /\b4 chords?\b|\bpop progression\b/, chords: ['G', 'D', 'Em', 'C'] },
  { name: 'the fifties progression', match: /\b(50s|fifties|doowop)\b/, chords: ['C', 'Am', 'F', 'G'] },
];

// ---------- the command ----------
// What was said -> { action, ... } or null if it isn't a command.
//   play { pattern|null, bpm? }   stop   tempo { bpm }   tempo_delta { delta }
//   next   prev   chord { chord|'' }   song { chords[], name? }   explain { chord }   what   help
//   teach { song } (one of `lessons`, by name) | teach { random: true } | teach { query } (any other song)
// lessons = [{ name, match }] (lesson.js's LESSONS): the songs that can be taught without a look-up.
export function parseCommand(text, { patterns = [], chords = [], lessons = [] } = {}) {
  const t = normalise(text);
  if (!t) return null;
  const tokens = t.split(' ');
  const has = re => re.test(t);
  const numbers = tokens.filter(w => /^\d+$/.test(w)).map(Number);
  const bpm = numbers.find(n => n >= 30 && n <= 200);

  if (has(/\bwhat am i (playing|holding)\b/) || (has(/\b(what|which) chord\b/) && has(/\b(am i|is this|is that|is it|playing|holding)\b/)))
    return { action: 'what' };

  // "teach me Riptide", "teach me this song, Wonderwall", "practise random chords". A chord
  // ("teach me A minor") is still explained below; "stop the lesson" is still a stop.
  if (has(/\b(teach|learn|practi[cs]e|lesson)\b/) && !has(/\b(stop|end|quit|cancel|enough)\b/)) {
    if (has(/\brandom\b|\b(basic|easy|simple|some|any) chords\b|\bchord (practi[cs]e|changes)\b/)) return { action: 'teach', random: true };
    const known = lessons.find(l => l.match.test(t));
    if (known) return { action: 'teach', song: known.name };
    const m = /\b(?:teach|learn|practi[cs]e)\b(?: me| us)?(?: how)?(?: to)?(?: play)?\s*(.*)$/.exec(t);
    const rest = (m ? m[1] : '').split(' ').filter(Boolean);
    const aSong = has(/\bsong\b/);
    if (aSong || rest.length > 4 || !chordsIn(rest, chords).length) {
      const query = rest.join(' ').replace(/^(?:(?:the|this|that|a|my) )?(?:song\b ?)?(?:called |named )?/, '')
        .replace(/\b(please|on (the )?guitar)\b/g, '').replace(/\s+/g, ' ').trim();
      if (query) return { action: 'teach', query };
      return aSong && lessons.length ? { action: 'teach', song: lessons[0].name } : { action: 'teach', random: true };
    }
  }

  if (has(/\bhow (do|can|would|should) (i|you|we) (play|make|hold|finger)\b|\bhow to (play|make|hold|finger)\b|\b(show|teach|tell) me\b|\bwhat is\b|\bwhat s\b|\bwhats\b|\bfingering\b/)) {
    const chord = pickChord(tokens, chords);
    if (chord) return { action: 'explain', chord };
  }

  if (has(/\b(help|what can i say|commands)\b/)) return { action: 'help' };
  if (has(/\b(stop|halt|pause|quiet|silence|enough)\b/)) return { action: 'stop' };

  const pattern = matchPattern(tokens, patterns);
  if (bpm !== undefined && has(/\b(tempo|speed|bpm|beats)\b/) && !pattern) return { action: 'tempo', bpm };
  const lots = has(/\b(much|lot|way)\b/) ? 2 : 1;
  if (has(/\b(faster|quicker|speed up|speed it up)\b/)) return { action: 'tempo_delta', delta: 10 * lots };
  if (has(/\b(slower|slow down|slow it down)\b/)) return { action: 'tempo_delta', delta: -10 * lots };

  if (has(/\b(clear|no|forget|remove) (the |my )?(song|progression|chords)\b|\bfree play\b/)) return { action: 'song', chords: [] };
  for (const s of SONGS) {
    if (has(s.match) && s.chords.every(c => chords.includes(c))) return { action: 'song', chords: s.chords, name: s.name };
  }
  const at = tokens.findIndex(w => ['chords', 'progression', 'song'].includes(w));
  if (at >= 0) {
    const list = chordsIn(tokens.slice(at + 1), chords, true).map(c => c.chord);
    if (list.length >= 2) return { action: 'song', chords: list };
  }

  if (!pattern && has(/\bnext\b/)) return { action: 'next' };
  if (!pattern && has(/\b(previous|go back|back one|last pattern)\b/)) return { action: 'prev' };

  if (has(/\b(all strings|every string|open strings|no chord)\b/)) return { action: 'chord', chord: '' };
  if (has(/\b(chord|key)\b/)) {
    const chord = pickChord(tokens, chords);
    if (chord) return { action: 'chord', chord };
  }

  if (pattern) return bpm !== undefined ? { action: 'play', pattern, bpm } : { action: 'play', pattern };
  if (has(/\b(play|start|go|begin|strumming)\b/)) return { action: 'play', pattern: null };
  return null;
}

// Words to bias speech-to-text towards: pattern names, chord names and the command words.
export function keyterms(patterns, chords, songs = []) {
  const terms = new Set(['guitar', 'tempo', 'BPM', 'faster', 'slower', 'chord', 'chords', 'twelve bar blues',
    'teach me', 'random chords', ...songs]);
  for (const p of patterns) { const w = patternWords(p).slice(0, 5).join(' '); if (w) terms.add(w); }
  for (const c of chords) terms.add(spokenChord(c));
  return [...terms].filter(k => k.length <= 50);
}
