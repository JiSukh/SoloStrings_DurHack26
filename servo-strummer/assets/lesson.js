// Song lessons: the song scrolls towards a line as tablature (which strings the robot plucks,
// and the fret your left hand holds on each), the robot plays each bar, and the microphone
// marks every bar green (the right chord was heard) or red. The logic is pure (no DOM, no
// network) so tests can run it in Node; LessonLane at the bottom is the only part that draws.
import { barEvents, barLength } from './twin.js';

// Chords for the random warm-up: the first ones anyone learns.
export const BASIC = ['G', 'C', 'D', 'Em', 'Am', 'E', 'A', 'Dm'];

// The lessons the page carries: one chord per bar, in easy keys, chords only. `match` runs on
// voice.js's normalised text (lower case, no punctuation). `pattern` = what the robot's right
// hand plays (a name from music.py's PATTERNS; plain "Strum" when left out). `kind` groups
// them in the page's list. To add one, add a line here: its chords must be in music.py's
// CHORDS, at most MAX_LESSON_BARS of them.
const times = (n, chords) => Array.from({ length: n }, () => chords).flat();
export const LESSONS = [
  // A minor one bar, G one bar, C two bars, round and round for the whole song
  { name: 'Riptide', kind: 'Songs', match: /\brip ?tide\b/, pattern: 'Riptide', chords: times(4, ['Am', 'G', 'C', 'C']) },
  { name: 'Knockin’ on Heaven’s Door', kind: 'Songs', match: /\bknockin|\bheavens? s? ?door\b/, chords: ['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C'] },
  { name: 'Stand by Me', kind: 'Songs', match: /\bstand by me\b/, chords: ['G', 'G', 'Em', 'Em', 'C', 'D', 'G', 'G'] },
  { name: 'Twelve bar blues', kind: 'Songs', match: /\b12 bar\b|\bblues\b/, chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'] },
  // fingerstyle: the robot picks single strings, so the tab shows exactly which ones ring
  { name: 'House of the Rising Sun', kind: 'Fingerstyle', match: /\brising sun\b/, pattern: 'Rising Sun arpeggio', chords: ['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E'] },
  { name: 'Travis picking', kind: 'Fingerstyle', match: /\btravis\b/, pattern: 'Travis picking', chords: times(2, ['C', 'Am', 'G', 'Em']) },
  { name: 'Fingerpicking study', kind: 'Fingerstyle', match: /\bfinger ?(style|picking)\b|\bp i m a\b/, pattern: 'Fingerstyle p-i-m-a', chords: times(2, ['Em', 'G', 'D', 'Am']) },
  { name: 'Arpeggio study', kind: 'Fingerstyle', match: /\barpeggios?\b/, pattern: 'Arpeggio up', chords: times(2, ['Am', 'Dm', 'G', 'C']) },
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

// One bar as tablature, from the steps the board plays (GET /steps): every pluck as
// { f: where in the bar it falls (0..1), strings: [0 = low E .. 5 = high e] }.
export function tabOf(steps) {
  const len = barLength(steps);
  return len ? barEvents(steps).map(ev => ({ f: ev.t / len, strings: ev.strings })) : [];
}

// How alike the sound and the wanted chord must be, at any one moment of the bar, for the bar
// to count (0..1: listen.js's matchChord score for that chord alone). It is the percentage the
// page's "Chord by ear" readout shows during a lesson: at 80% or more the bar goes green. A
// similar chord can still reach it now and then; lower it to forgive more, raise it to forgive less.
export const PASS_SCORE = 0.8;

// One bar's verdict from what the ear heard in it: the likeness to the wanted chord at each
// reading (null = too quiet to tell). One good moment is enough.
export function gradeBar(scores, pass = PASS_SCORE) {
  return scores.some(x => x !== null && x >= pass) ? 'hit' : 'miss';
}

// One run through a song. Times are page milliseconds (performance.now()).
export class Lesson {
  // startAt: when bar 0 is planned to start; the real starts arrive through onBar.
  // tabs: { chord: tabOf(...) } for the notes drawn on the lane (optional).
  constructor({ title, chords, barMs, startAt, tabs = {} }) {
    this.title = title;
    this.chords = chords;
    this.barMs = barMs;
    this.startAt = startAt;
    this.tabs = tabs;
    this.starts = [];                          // when each bar really started, once known
    this.readings = chords.map(() => []);
    this.grades = chords.map(() => null);      // 'hit' | 'miss' once the bar is over
    this.wonAt = chords.map(() => null);       // when the bar was first heard right
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

  // The strings the robot has plucked so far in the bar being played at t (from its tab), low
  // E = 0. Picked one at a time, the whole chord isn't ringing until late in the bar, so the
  // page compares the sound with just these and the bar can be won on its first notes.
  pluckedAt(t) {
    const i = this.barAt(t), tab = i < 0 ? null : this.tabs[this.chords[i]];
    if (!tab) return [];
    const f = (t - this.barStart(i)) / this.barMs;
    return [...new Set(tab.filter(ev => ev.f <= f).flatMap(ev => ev.strings))].sort((a, b) => a - b);
  }

  // At time t the sound was `score` like the chord wanted then (null: too quiet to tell).
  // Returns the bar's number if this is the reading that won it, else -1.
  hear(t, score) {
    const i = this.barAt(t);
    if (i < 0 || this.grades[i]) return -1;
    this.readings[i].push(score);
    if (this.wonAt[i] !== null || gradeBar(this.readings[i]) !== 'hit') return -1;
    this.wonAt[i] = t;
    return i;
  }

  // Give every bar that is over by t its verdict. Returns the bars that just got 'miss'.
  settle(t) {
    const missed = [];
    for (let i = 0; i < this.chords.length; i++) {
      if (this.grades[i] || t < this.barStart(i) + this.barMs) continue;
      this.grades[i] = gradeBar(this.readings[i]);
      if (this.grades[i] === 'miss') missed.push(i);
    }
    return missed;
  }

  // 'hit' | 'miss' once over; before that 'hit' as soon as the bar is already won, else null.
  look(i) {
    return this.grades[i] || (this.wonAt[i] !== null ? 'hit' : null);
  }

  // Bars won in a row up to the last one decided, and the longest such run so far.
  streak() {
    let now = 0, best = 0;
    for (let i = 0; i < this.chords.length; i++) {
      const v = this.look(i);
      if (!v) break;
      now = v === 'hit' ? now + 1 : 0;
      best = Math.max(best, now);
    }
    return { now, best };
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
const AHEAD = 2.5;                               // bars visible to the right of the line
const NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];    // string names, low E first (as twin.js)
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const easeOut = p => 1 - (1 - clamp(p, 0, 1)) ** 3;

export class LessonLane {
  // shapes: { chord: "x32010" } for the fret numbers and the fingering diagram.
  // onCount(beatsLeft): called once per count-in beat (4, 3, 2, 1), for the page's tick sound.
  constructor(canvas, shapes = {}) {
    this.canvas = canvas;
    this.shapes = shapes;
    this.lesson = null;
    this.frame = null;
    this.idle = '';
    this.onCount = null;
    this.still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reset();
    addEventListener('resize', () => this.draw());
  }

  reset() {
    this.sparks = [];                      // paper confetti: { x, y, vx, vy, spin, t0, life, colour }
    this.rings = [];                       // expanding rings: { x, y, t0, colour, big }
    this.words = [];                       // rising words: { text, x, y, t0 }
    this.pulse = new Array(6).fill(0);     // how brightly each string is lit (a note just crossed)
    this.seen = { won: new Set(), missed: new Set(), count: null, ended: false };
    this.shakeAt = -Infinity;
    this.lastNow = null;
  }

  show(lesson) {
    if (lesson !== this.lesson) this.reset();
    this.lesson = lesson;
    if (!this.frame) this.tick();
  }

  // Keeps drawing while a lesson runs, and for a few seconds after for the closing animation.
  tick() {
    this.draw();
    const l = this.lesson;
    const live = l && (l.endedAt === null || performance.now() - l.endedAt < 4000);
    this.frame = live ? requestAnimationFrame(() => this.tick()) : null;
  }

  colours() {
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
    return { fg: v('--fg'), muted: v('--muted'), accent: v('--accent'), line: v('--line'), ok: v('--ok'),
      card: v('--card'), on: v('--on-accent'), soft: v('--soft'), display: v('--font-display'), body: v('--font') };
  }

  burst(x, y, n, colours) {
    if (this.still) return;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.08 + Math.random() * 0.28;
      this.sparks.push({ x, y, vx: Math.cos(a) * v + 0.06, vy: Math.sin(a) * v - 0.12, spin: Math.random() * 6,
        t0, life: 700 + Math.random() * 500, colour: colours[i % colours.length] });
    }
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
    g.globalAlpha = 1;
    const l = this.lesson;
    if (!l) {
      g.fillStyle = k.muted; g.textAlign = 'center'; g.font = `16px ${k.body}`;
      g.fillText(this.idle, w / 2, h / 2, w - 32);
      return;
    }
    const now = performance.now();
    if (l.endedAt !== null) this.drawSummary(g, k, w, h, now);
    else this.drawLane(g, k, w, h, now);
    this.drawEffects(g, k, now);
    this.lastNow = now;
  }

  drawLane(g, k, w, h, now) {
    const l = this.lesson;
    // ---- geometry ----
    const hitX = w < 520 ? 92 : clamp(w * 0.24, 150, 210);       // the line; left of it is the "now" panel
    const hud = 30, bandY = hud + 4, bandH = clamp(h * 0.22, 36, 60);
    const tabTop = bandY + bandH + 16, tabBottom = h - 14;
    const rowY = s => tabTop + (5 - s) * (tabBottom - tabTop) / 5;  // high e on top, like tab
    const pxPerMs = (w - hitX) / (AHEAD * l.barMs), X = t => hitX + (t - now) * pxPerMs;
    const at = l.barAt(now), beatMs = l.barMs / 4, first = l.barStart(0);
    const beatPhase = (((now - first) % beatMs) + beatMs) % beatMs / beatMs;  // 0 on the beat
    const thump = this.still ? 0 : (1 - beatPhase) ** 3;                      // a kick on every beat

    // ---- what just happened (drives the pulses, confetti and words) ----
    l.chords.forEach((chord, i) => {
      if (l.wonAt[i] !== null && !this.seen.won.has(i)) {
        this.seen.won.add(i);
        const run = l.streak().now, y = bandY + bandH / 2;
        this.rings.push({ x: hitX, y, t0: now, colour: k.ok, big: true });
        this.burst(hitX, y, 14 + Math.min(run, 6) * 3, [k.ok, k.ok, k.fg, k.accent]);
        this.words.push({ text: run >= 2 ? `${run} in a row` : 'Nice', x: hitX + 16, y: bandY + bandH + 4, t0: now });
      }
      if (l.grades[i] === 'miss' && !this.seen.missed.has(i)) { this.seen.missed.add(i); this.shakeAt = now; }
    });
    const beatsLeft = Math.ceil((first - now) / beatMs);
    if (beatsLeft > 0 && beatsLeft <= 4 && beatsLeft !== this.seen.count) {
      this.seen.count = beatsLeft;
      if (this.onCount) this.onCount(beatsLeft);
    }

    // ---- the moving part, clipped to the right of the line ----
    g.save();
    g.beginPath(); g.rect(hitX, 0, w - hitX, h); g.clip();
    // bar lines and beat lines
    for (let i = 0; i <= l.chords.length; i++) {
      for (let b = 0; b < (i < l.chords.length ? 4 : 1); b++) {
        const x = X(l.barStart(i) + b * beatMs);
        if (x < hitX - 2 || x > w + 2) continue;
        g.strokeStyle = k.line; g.lineWidth = b ? 1 : 2; g.globalAlpha = b ? 0.5 : 1;
        g.beginPath(); g.moveTo(x, b ? tabTop - 6 : bandY); g.lineTo(x, tabBottom + 6); g.stroke();
      }
    }
    g.globalAlpha = 1;
    // strings: thicker towards low E, lit for a moment when a note crosses the line
    for (let s = 0; s < 6; s++) {
      const p = this.pulse[s];
      g.strokeStyle = p > 0.04 ? k.accent : k.muted; g.globalAlpha = p > 0.04 ? 1 : 0.55;
      g.lineWidth = 1 + (5 - s) * 0.3 + p * 2;
      g.beginPath(); g.moveTo(hitX, rowY(s)); g.lineTo(w, rowY(s)); g.stroke();
      this.pulse[s] *= 0.9;
    }
    g.globalAlpha = 1;
    // chord tiles along the top, one per bar
    const since = now - this.shakeAt;  // a missed bar shakes the tiles for a third of a second
    const shake = this.still || since > 320 ? 0 : Math.sin(since / 18) * 5 * (1 - since / 320);
    l.chords.forEach((chord, i) => {
      const x = X(l.barStart(i)) + 3 + shake, tw = l.barMs * pxPerMs - 6;
      if (x > w || x + tw < hitX) return;
      const look = l.look(i), pop = look === 'hit' && l.wonAt[i] !== null ? 3 * (1 - easeOut((now - l.wonAt[i]) / 260)) : 0;
      g.fillStyle = look === 'hit' ? k.ok : look === 'miss' ? k.accent : k.card;
      g.strokeStyle = look ? g.fillStyle : i === at ? k.fg : k.line; g.lineWidth = i === at ? 2 : 1;
      g.beginPath(); g.rect(x - pop, bandY - pop, tw + 2 * pop, bandH + 2 * pop); g.fill(); g.stroke();
      g.fillStyle = look ? k.on : k.fg; g.textAlign = 'left';
      g.font = `500 ${clamp(bandH * 0.52, 16, 28)}px ${k.display}`;
      g.fillText(chord, Math.max(x, hitX + 4) + 12, bandY + bandH / 2 + 1, tw - 20);
    });
    // the notes: a dot on its string with the fret to hold (0 = open), as in tablature
    const r = clamp((tabBottom - tabTop) / 5 * 0.44, 7, 12);
    l.chords.forEach((chord, i) => {
      const tab = l.tabs[chord], shape = this.shapes[chord], start = l.barStart(i);
      if (!tab || !shape || X(start) > w + r || X(start + l.barMs) < hitX - r) return;
      for (const ev of tab) {
        const t = start + ev.f * l.barMs, x = X(t);
        if (this.lastNow !== null && t > this.lastNow && t <= now) {  // crossing the line right now
          for (const s of ev.strings) { this.pulse[s] = 1; this.rings.push({ x: hitX, y: rowY(s), t0: now, colour: k.accent, big: false }); }
        }
        if (x < hitX - r || x > w + r) continue;
        const near = x - hitX < r * 1.6;
        for (const s of ev.strings) {
          if (shape[s] === 'x') continue;
          g.fillStyle = near ? k.accent : k.card; g.strokeStyle = near ? k.accent : k.fg; g.lineWidth = 1.5;
          g.beginPath(); g.arc(x, rowY(s), r, 0, 7); g.fill(); g.stroke();
          g.fillStyle = near ? k.on : k.fg; g.textAlign = 'center'; g.font = `600 ${Math.round(r * 1.25)}px ${k.body}`;
          g.fillText(shape[s], x, rowY(s) + 1);
        }
      }
    });
    g.restore();

    // ---- the "now" panel: the chord to hold and how to finger it ----
    const chord = l.chords[at >= 0 ? at : now < first ? 0 : l.chords.length - 1];
    g.fillStyle = k.card; g.fillRect(0, 0, hitX, h);
    g.fillStyle = k.muted; g.textAlign = 'left'; g.font = `14px ${k.body}`;
    g.fillText(now < first ? 'Get ready' : 'Now', 14, hud / 2 + 2);
    g.fillStyle = k.fg; g.font = `500 ${clamp(bandH * 0.7, 22, 38)}px ${k.display}`;
    g.fillText(chord, 14, bandY + bandH / 2 + 1, hitX - 28);
    const room = tabBottom - tabTop;
    if (this.shapes[chord] && hitX >= 150 && room >= 70) {
      const gw = Math.min(70, hitX - 84), gh = Math.min(room - 14, gw * 1.1);
      this.diagram(g, 22, tabTop + 12 + (room - 14 - gh) / 2, gw, gh, this.shapes[chord], k.fg);
    }
    // string names beside the line
    g.fillStyle = k.muted; g.textAlign = 'right'; g.font = `14px ${k.body}`;
    for (let s = 0; s < 6; s++) g.fillText(NAMES[s], hitX - 10, rowY(s) + 1);
    // the line itself, swelling on each beat
    g.strokeStyle = k.fg; g.lineWidth = 3 + thump * 3;
    g.beginPath(); g.moveTo(hitX, 2); g.lineTo(hitX, h - 2); g.stroke();

    // ---- heads-up: title, score, run, and how far through ----
    const hits = l.chords.filter((_, i) => l.look(i) === 'hit').length, run = l.streak().now;
    g.textAlign = 'left'; g.fillStyle = k.fg; g.font = `500 15px ${k.display}`;
    g.fillText(l.title, hitX + 12, hud / 2 + 2, w - hitX - 190);
    g.textAlign = 'right';
    g.fillText(`${hits} / ${l.chords.length}`, w - 12, hud / 2 + 2);
    if (run >= 2) { g.fillStyle = k.ok; g.fillText(`${run} in a row`, w - 76, hud / 2 + 2); }
    const done = clamp((now - first) / (l.endAt - first), 0, 1);
    g.fillStyle = k.line; g.fillRect(hitX, 0, w - hitX, 3);
    g.fillStyle = k.accent; g.fillRect(hitX, 0, (w - hitX) * done, 3);

    // ---- count-in: a big number that lands on each beat ----
    if (beatsLeft > 0) {
      const size = Math.min(96, h * 0.5) * (1 + 0.25 * thump);
      g.fillStyle = k.accent; g.textAlign = 'center'; g.globalAlpha = 0.9;
      g.font = `500 ${beatsLeft > 4 ? size * 0.5 : size}px ${k.display}`;
      g.fillText(beatsLeft > 4 ? 'Get ready' : String(beatsLeft), hitX + (w - hitX) / 2, tabTop + (tabBottom - tabTop) / 2);
      g.globalAlpha = 1;
    }
  }

  // Fingering, the way chord boxes are printed: low E on the left, the nut on top.
  diagram(g, x, y, gw, gh, shape, ink) {
    const sx = gw / 5, fy = gh / 4;
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
        g.beginPath(); g.moveTo(cx - 3, y - 11); g.lineTo(cx + 3, y - 5); g.moveTo(cx + 3, y - 11); g.lineTo(cx - 3, y - 5); g.stroke();
      } else if (ch === '0') {  // open: a small ring
        g.beginPath(); g.arc(cx, y - 8, 3, 0, 7); g.stroke();
      } else {
        g.beginPath(); g.arc(cx, y + (Number(ch) - 0.5) * fy, Math.min(5.5, sx * 0.42), 0, 7); g.fill();
      }
    });
  }

  // After the last bar: the score fills a ring, with the whole song beside it, bar by bar.
  drawSummary(g, k, w, h, now) {
    const l = this.lesson, { hits, total } = l.score(), ratio = total ? hits / total : 0;
    const good = ratio >= 0.7, colour = good ? k.ok : k.accent, p = this.still ? 1 : easeOut((now - l.endedAt) / 1100);
    const R = clamp(h * 0.3, 34, 74), cx = Math.max(R + 28, Math.min(w * 0.2, 150)), cy = h / 2;
    if (!this.seen.ended) {
      this.seen.ended = true;
      if (good) this.burst(cx, cy, 46, [k.ok, k.ok, k.fg, k.accent]);
      this.rings.push({ x: cx, y: cy, t0: now, colour, big: true });
    }
    g.lineCap = 'round';
    g.strokeStyle = k.line; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    if (ratio > 0) {
      g.strokeStyle = colour;
      g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio * p); g.stroke();
    }
    g.lineCap = 'butt';
    g.fillStyle = k.fg; g.textAlign = 'center'; g.font = `500 ${R * 0.58}px ${k.display}`;
    g.fillText(`${Math.round(ratio * 100 * p)}%`, cx, cy + 2);

    const x0 = cx + R + 30, room = w - x0 - 16;
    if (room < 120) return;
    const big = clamp(h * 0.13, 20, 30);
    g.textAlign = 'left'; g.fillStyle = k.fg; g.font = `500 ${big}px ${k.display}`;
    g.fillText(ratio === 1 ? 'Perfect run' : good ? 'Nice work' : 'Keep at it', x0, cy - R * 0.62, room);
    g.fillStyle = k.muted; g.font = `15px ${k.body}`;
    g.fillText(`${l.title} · ${hits} of ${total} chords · best run ${l.streak().best}`, x0, cy - R * 0.62 + big + 2, room);
    // every bar in its colour, appearing left to right
    const n = l.chords.length, perRow = n > 16 ? Math.ceil(n / 2) : n, rows = Math.ceil(n / perRow), gap = 5;
    const tw = (room - (perRow - 1) * gap) / perRow, th = clamp(R * 0.5, 22, 38), y0 = cy + R - rows * th - (rows - 1) * gap;
    l.chords.forEach((chord, i) => {
      if (i / n > p) return;
      const x = x0 + (i % perRow) * (tw + gap), y = y0 + Math.floor(i / perRow) * (th + gap);
      g.fillStyle = l.grades[i] === 'hit' ? k.ok : k.accent;
      g.fillRect(x, y, tw, th);
      if (tw < 30) return;
      g.fillStyle = k.on; g.textAlign = 'center'; g.font = `500 ${clamp(tw / 2.6, 14, 18)}px ${k.display}`;
      g.fillText(chord, x + tw / 2, y + th / 2 + 1, tw - 6);
    });
  }

  // Rings, paper confetti and rising words, on top of everything.
  drawEffects(g, k, now) {
    this.rings = this.rings.filter(r => now - r.t0 < (r.big ? 620 : 300));
    for (const r of this.rings) {
      const p = (now - r.t0) / (r.big ? 620 : 300);
      g.strokeStyle = r.colour; g.globalAlpha = (1 - p) * (r.big ? 0.8 : 0.6); g.lineWidth = r.big ? 3 : 2;
      g.beginPath(); g.arc(r.x, r.y, (r.big ? 10 : 6) + easeOut(p) * (r.big ? 62 : 16), 0, 7); g.stroke();
    }
    this.sparks = this.sparks.filter(s => now - s.t0 < s.life);
    for (const s of this.sparks) {
      const t = now - s.t0, p = t / s.life;
      g.save();
      g.translate(s.x + s.vx * t, s.y + s.vy * t + 0.0005 * t * t);  // a little gravity
      g.rotate(s.spin + t * 0.012);
      g.globalAlpha = 1 - p * p; g.fillStyle = s.colour;
      g.fillRect(-3, -2, 6, 4);
      g.restore();
    }
    this.words = this.words.filter(x => now - x.t0 < 1000);
    for (const x of this.words) {
      const p = (now - x.t0) / 1000;
      g.globalAlpha = 1 - p * p; g.fillStyle = k.ok; g.textAlign = 'left';
      g.font = `italic 500 18px ${k.display}`;
      g.fillText(x.text, x.x, x.y + 14 - easeOut(p) * 14);
    }
    g.globalAlpha = 1;
  }
}
