// Song lessons: chords slide towards a line, the robot strums each bar, and the microphone
// marks every bar green (the right chord was heard) or red. The logic is pure (no DOM, no
// network) so tests can run it in Node; LessonLane at the bottom is the only part that draws.

// Chords for the random warm-up: the first ones anyone learns.
export const BASIC = ['G', 'C', 'D', 'Em', 'Am', 'E', 'A', 'Dm'];

// Songs the page carries: one chord per bar, in easy keys, chords only. `match` runs on
// voice.js's normalised text (lower case, no punctuation). `pattern` = the strum the robot
// uses (a name from music.py's PATTERNS; plain "Strum" when left out). Any other song is
// looked up with Gemini (gemini.js) when the board has a key.
const times = (n, chords) => Array.from({ length: n }, () => chords).flat();
export const LESSONS = [
  // A minor one bar, G one bar, C two bars, round and round for the whole song
  { name: 'Riptide', match: /\brip ?tide\b/, pattern: 'Riptide', chords: times(4, ['Am', 'G', 'C', 'C']) },
  { name: 'Knockin’ on Heaven’s Door', match: /\bknockin|\bheavens? s? ?door\b/, chords: ['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C'] },
  { name: 'Stand by Me', match: /\bstand by me\b/, chords: ['G', 'G', 'Em', 'Em', 'C', 'D', 'G', 'G'] },
  { name: 'Twelve bar blues', match: /\b12 bar\b|\bblues\b/, chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'] },
];

export const MAX_LESSON_BARS = 32;

// n chords from `pool`, never the same one twice in a row (a change is the thing to practise).
export function randomChords(n = 8, pool = BASIC, rng = Math.random) {
  const out = [];
  while (out.length < n) {
    const c = pool[Math.floor(rng() * pool.length) % pool.length];
    if (pool.length > 1 && c === out[out.length - 1]) continue;
    out.push(c);
  }
  return out;
}

// A progression from outside (Gemini, a typed list) -> chords the strummer knows, or null if
// too little of it survives to be the song. `known` = the strummer's chord names.
export function cleanProgression(list, known, max = MAX_LESSON_BARS) {
  if (!Array.isArray(list)) return null;
  const byLower = Object.fromEntries(known.map(k => [k.toLowerCase(), k]));
  const names = list.map(c => byLower[String(c).trim().toLowerCase()]);
  const kept = names.filter(Boolean);
  if (kept.length < 4 || kept.length < names.length * 0.75 || new Set(kept).size < 2) return null;
  return kept.slice(0, max);
}

// How alike the sound and the wanted chord must be, at any one moment of the bar, for the bar
// to count (0..1: listen.js's matchChord score for that chord alone). 0.5 is very forgiving:
// a guitar that is roughly in tune and roughly on the chord passes, and a bar is only red when
// nothing was heard or the sound was far off. Raise it (0.75 is strict) to make lessons harder.
export const PASS_SCORE = 0.5;

// One bar's verdict from what the ear heard in it: the likeness to the wanted chord at each
// reading (null = too quiet to tell). One good moment is enough.
export function gradeBar(scores, pass = PASS_SCORE) {
  return scores.some(x => x !== null && x >= pass) ? 'hit' : 'miss';
}

// One run through a song. Times are page milliseconds (performance.now()).
export class Lesson {
  // startAt: when bar 0 is planned to start; the real starts arrive through onBar.
  constructor({ title, chords, barMs, startAt }) {
    this.title = title;
    this.chords = chords;
    this.barMs = barMs;
    this.startAt = startAt;
    this.starts = [];                          // when each bar really started, once known
    this.readings = chords.map(() => []);
    this.grades = chords.map(() => null);      // 'hit' | 'miss' once the bar is over
    this.endedAt = null;
  }

  // The robot started bar `no` at `at`; its bars are `barMs` long (the knob may have moved).
  onBar(no, at, barMs) {
    if (no < 0 || no >= this.chords.length) return;
    this.starts[no] = at;
    if (barMs > 0) this.barMs = barMs;
  }

  // When bar i starts: as reported, else counted on from the last bar that was.
  barStart(i) {
    for (let j = Math.min(i, this.chords.length - 1); j >= 0; j--) {
      if (this.starts[j] !== undefined) return this.starts[j] + (i - j) * this.barMs;
    }
    return this.startAt + i * this.barMs;
  }

  get endAt() { return this.barStart(this.chords.length); }

  barAt(t) {
    for (let i = this.chords.length - 1; i >= 0; i--) {
      if (t >= this.barStart(i)) return t < this.barStart(i) + this.barMs ? i : -1;
    }
    return -1;
  }

  // The chord wanted at time t, or null between bars.
  chordAt(t) {
    const i = this.barAt(t);
    return i < 0 ? null : this.chords[i];
  }

  // At time t the sound was `score` like the chord wanted then (null: too quiet to tell).
  hear(t, score) {
    const i = this.barAt(t);
    if (i < 0 || this.grades[i]) return;
    this.readings[i].push(score);
  }

  // Give every bar that is over by t its verdict.
  settle(t) {
    for (let i = 0; i < this.chords.length; i++) {
      if (!this.grades[i] && t >= this.barStart(i) + this.barMs) this.grades[i] = gradeBar(this.readings[i]);
    }
  }

  // 'hit' | 'miss' once over; before that 'hit' as soon as the bar is already won, else null.
  look(i) {
    return this.grades[i] || (gradeBar(this.readings[i]) === 'hit' ? 'hit' : null);
  }

  finish(t) {
    this.settle(Infinity);
    this.endedAt = t;
  }

  score() {
    return { hits: this.grades.filter(g => g === 'hit').length, total: this.chords.length };
  }
}

// ---------- drawing ----------
const AHEAD = 3;  // bars visible to the right of the line

export class LessonLane {
  // shapes: { chord: "x32010" } for the small fingering diagram on each tile
  constructor(canvas, shapes = {}) {
    this.canvas = canvas;
    this.shapes = shapes;
    this.lesson = null;
    this.frame = null;
    this.idle = '';
    addEventListener('resize', () => this.draw());
  }

  show(lesson) {
    this.lesson = lesson;
    if (!this.frame) this.tick();
  }

  tick() {
    this.draw();
    const l = this.lesson;
    this.frame = l && l.endedAt === null ? requestAnimationFrame(() => this.tick()) : null;
  }

  colours() {
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
    return { fg: v('--fg'), muted: v('--muted'), accent: v('--accent'), line: v('--line'), ok: v('--ok'),
      card: v('--card'), on: v('--on-accent'), display: v('--font-display'), body: v('--font') };
  }

  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext('2d'), k = this.colours();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.textBaseline = 'middle';
    const l = this.lesson;
    if (!l) {
      g.fillStyle = k.muted; g.textAlign = 'center'; g.font = `16px ${k.body}`;
      g.fillText(this.idle, w / 2, h / 2, w - 32);
      return;
    }
    if (l.endedAt !== null) return this.drawSummary(g, k, w, h);

    const now = performance.now(), hitX = Math.max(84, w * 0.22);
    const pxPerMs = (w - hitX) / (AHEAD * l.barMs), top = 14, tileH = h - 28;
    l.chords.forEach((chord, i) => {
      const x = hitX + (l.barStart(i) - now) * pxPerMs, tw = l.barMs * pxPerMs - 6;
      if (x > w || x + tw < 0) return;
      this.tile(g, k, { x, y: top, w: tw, h: tileH, chord, look: l.look(i), current: i === l.barAt(now) });
    });
    // the line the chords are played at
    g.strokeStyle = k.fg; g.lineWidth = 3;
    g.beginPath(); g.moveTo(hitX, 4); g.lineTo(hitX, h - 4); g.stroke();
    // count-in: the beats left before the first bar
    const beats = Math.ceil((l.barStart(0) - now) / (l.barMs / 4));
    if (beats > 0) {
      g.fillStyle = k.accent; g.textAlign = 'center'; g.font = `500 ${Math.min(64, h * 0.45)}px ${k.display}`;
      g.fillText(beats > 4 ? 'Ready' : String(beats), hitX / 2, h / 2, hitX - 16);
    }
  }

  tile(g, k, { x, y, w, h, chord, look, current }) {
    const fill = look === 'hit' ? k.ok : look === 'miss' ? k.accent : k.card;
    const ink = look ? k.on : k.fg;
    g.fillStyle = fill; g.strokeStyle = current && !look ? k.fg : look ? fill : k.line; g.lineWidth = current ? 2 : 1;
    g.beginPath(); g.rect(x, y, w, h); g.fill(); g.stroke();
    const diagram = this.shapes[chord] && w >= 150 && h >= 96;
    g.fillStyle = ink; g.textAlign = 'left';
    g.font = `500 ${Math.min(40, w / 3.2)}px ${k.display}`;
    g.fillText(chord, x + 14, y + h / 2, diagram ? w - 96 : w - 24);
    if (diagram) this.diagram(g, x + w - 76, y + h / 2 - 30, this.shapes[chord], ink);
  }

  // Fingering, the way chord boxes are printed: low E on the left, the nut on top.
  diagram(g, x, y, shape, ink) {
    const gw = 55, gh = 56, sx = gw / 5, fy = gh / 4;
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1;
    for (let s = 0; s < 6; s++) { g.beginPath(); g.moveTo(x + s * sx, y); g.lineTo(x + s * sx, y + gh); g.stroke(); }
    for (let f = 0; f <= 4; f++) {
      g.lineWidth = f === 0 ? 3 : 1;
      g.beginPath(); g.moveTo(x, y + f * fy); g.lineTo(x + gw, y + f * fy); g.stroke();
    }
    g.lineWidth = 1.5;
    [...shape].forEach((ch, s) => {
      const cx = x + s * sx;
      if (ch === 'x') {  // not played: a small cross above the nut
        g.beginPath(); g.moveTo(cx - 3, y - 10); g.lineTo(cx + 3, y - 4); g.moveTo(cx + 3, y - 10); g.lineTo(cx - 3, y - 4); g.stroke();
      } else if (ch === '0') {  // open: a small ring
        g.beginPath(); g.arc(cx, y - 7, 3, 0, 7); g.stroke();
      } else {
        g.beginPath(); g.arc(cx, y + (Number(ch) - 0.5) * fy, 4.5, 0, 7); g.fill();
      }
    });
  }

  // After the last bar: the whole song at once, each bar in its colour.
  drawSummary(g, k, w, h) {
    const l = this.lesson, n = l.chords.length, perRow = n > 16 ? Math.ceil(n / 2) : n, rows = Math.ceil(n / perRow);
    const pad = 12, gap = 6, tw = (w - 2 * pad - (perRow - 1) * gap) / perRow, th = Math.min(72, (h - 2 * pad - (rows - 1) * gap) / rows);
    const y0 = (h - rows * th - (rows - 1) * gap) / 2;
    g.textAlign = 'center';
    l.chords.forEach((chord, i) => {
      const x = pad + (i % perRow) * (tw + gap), y = y0 + Math.floor(i / perRow) * (th + gap);
      g.fillStyle = l.grades[i] === 'hit' ? k.ok : k.accent;
      g.fillRect(x, y, tw, th);
      g.fillStyle = k.on; g.font = `500 ${Math.max(14, Math.min(26, tw / 2.6))}px ${k.display}`;
      g.fillText(chord, x + tw / 2, y + th / 2, tw - 6);
    });
  }
}
