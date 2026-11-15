// The lesson's sounds, made in the browser (no files): a tick on each count-in beat, a small
// bell chord when a bar is played right (the notes of that very chord, so it sits with the
// guitar), a soft low note for a miss, and a rising run at the end.

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// The three notes of a chord name, as MIDI numbers in a bright octave: "Am" -> A5 C6 E6.
export function chimeNotes(chord) {
  const m = /^([A-G])(.*)$/.exec(chord || '');
  if (!m) return [84, 88, 91];
  const root = 72 + PITCH[m[1]], minor = /^m(?!aj)/.test(m[2]);
  const third = /^sus2/.test(m[2]) ? 2 : /^sus4/.test(m[2]) ? 5 : minor ? 3 : 4;
  return [root, root + third, root + 7];
}

const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export class Fx {
  // audio: () => AudioContext (the page's one context, created after a click)
  constructor(audio) {
    this.audio = audio;
    this.on = true;
  }

  // One soft bell: a sine with a quieter octave above, fading out.
  bell(midi, when = 0, level = 0.16, long = 0.5) {
    const ctx = this.audio(), at = ctx.currentTime + when, out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, at);
    out.gain.exponentialRampToValueAtTime(level, at + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, at + long);
    out.connect(ctx.destination);
    for (const [mult, part] of [[1, 1], [2, 0.35]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = hz(midi) * mult; g.gain.value = part;
      osc.connect(g).connect(out);
      osc.start(at); osc.stop(at + long + 0.05);
    }
  }

  play(fn) {
    if (!this.on) return;
    try { fn(); } catch {}  // no sound is never a reason to stop the lesson
  }

  // Count-in: a woodblock-like tick, higher on the last beat.
  tick(beatsLeft) {
    this.play(() => {
      const ctx = this.audio(), at = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = beatsLeft === 1 ? 1320 : 880;
      g.gain.setValueAtTime(0.14, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
      osc.connect(g).connect(ctx.destination);
      osc.start(at); osc.stop(at + 0.09);
    });
  }

  // A bar played right: its chord, rolled upwards. A longer run adds a top note.
  hit(chord, run = 1) {
    this.play(() => {
      const notes = chimeNotes(chord);
      notes.forEach((n, i) => this.bell(n, i * 0.055, 0.15));
      if (run >= 3) this.bell(notes[0] + 12, 3 * 0.055, 0.13, 0.7);
    });
  }

  // A bar missed: one low, short, quiet note. Not a punishment.
  miss() {
    this.play(() => {
      const ctx = this.audio(), at = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(150, at); osc.frequency.exponentialRampToValueAtTime(95, at + 0.16);
      g.gain.setValueAtTime(0.16, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(at); osc.stop(at + 0.22);
    });
  }

  // The end: a run up the last chord for a good score, two calm notes otherwise.
  finish(chord, ratio) {
    this.play(() => {
      const [a, b, c] = chimeNotes(chord);
      const run = ratio >= 0.7 ? [a - 12, b - 12, c - 12, a, b, c, a + 12] : [c - 12, a - 12];
      run.forEach((n, i) => this.bell(n, i * 0.09, 0.15, i === run.length - 1 ? 1.2 : 0.5));
    });
  }
}
