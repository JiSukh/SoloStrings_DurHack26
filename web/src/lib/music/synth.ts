// Virtual guitar: a digital twin of the robot. It plays the same steps the board gets
// ("mask, ms" pairs from strummer/music.py), drawing each string and pick and synthesising the
// sound. (Ported from assets/twin.js.)

export type Step = [mask: number, ms: number];
export interface BarEvent { t: number; strings: number[] }

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];  // E2 A2 D3 G3 B3 E4, low E first
const NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

// Pitch of string s with the left hand holding `shape` ("x32010"); open strings with no chord.
export function noteMidi(shape: string | null, s: number): number | null {
  const fret = shape ? shape[s] : '0';
  return fret === 'x' ? null : OPEN_MIDI[s] + Number(fret);
}

// Steps -> [{ t: ms from bar start, strings: [...] }], one entry per pluck (mask 0 = rest).
export function barEvents(steps: Step[]): BarEvent[] {
  const out: BarEvent[] = [];
  let t = 0;
  for (const [mask, ms] of steps) {
    if (mask) out.push({ t, strings: [0, 1, 2, 3, 4, 5].filter(s => mask & (1 << s)) });
    t += ms;
  }
  return out;
}

export const barLength = (steps: Step[]) => steps.reduce((sum, [, ms]) => sum + ms, 0);

// Karplus-Strong: a noise burst circulating in a delay line one period long, lightly
// low-passed each trip, rings and decays like a plucked string.
function pluckBuffer(ctx: AudioContext, midi: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.round(sr / (440 * 2 ** ((midi - 69) / 12)));
  const buf = ctx.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  for (let i = n; i < d.length; i++) d[i] = 0.996 * 0.5 * (d[i - n] + d[i - n - 1 < 0 ? 0 : i - n - 1]);
  return buf;
}

export class VirtualGuitar {
  canvas: HTMLCanvasElement | null = null;
  shape: string | null = null;           // chord shape the left hand holds
  energy = new Array(6).fill(0);         // how hard each string is ringing (drawing only)
  sideB = new Array(6).fill(false);      // which side of the string each pick is on, like the servos
  sound = false;
  private ctx: AudioContext | null = null;
  private buffers: Record<number, AudioBuffer> = {};
  private voices: ({ src: AudioBufferSourceNode; gain: GainNode } | null)[] = new Array(6).fill(null);
  private timers: ReturnType<typeof setTimeout>[] = [];
  private frame = 0;

  // Start drawing on `canvas` (the component calls this once it is mounted).
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  detach() {
    cancelAnimationFrame(this.frame);
    this.canvas = null;
  }

  audio(): AudioContext {  // AudioContext must be created after a click
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  pluck(s: number, when = 0) {
    this.sideB[s] = !this.sideB[s];
    this.energy[s] = 1;
    const midi = noteMidi(this.shape, s);
    if (!this.sound || midi === null) return;
    const ctx = this.audio();
    const at = ctx.currentTime + when;
    const old = this.voices[s];
    if (old) {  // one string, one note: damp the old one
      old.gain.gain.setTargetAtTime(0, at, 0.01);
      old.src.stop(at + 0.1);
    }
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = this.buffers[midi] ||= pluckBuffer(ctx, midi);
    gain.gain.value = 0.25;
    src.connect(gain).connect(ctx.destination);
    src.start(at);
    this.voices[s] = { src, gain };
  }

  // Play one bar of steps starting `delayMs` from now, with the left hand on `shape`.
  // Plucks up to 150 ms late still play; older ones are skipped.
  playBar(steps: Step[], delayMs = 0, shape: string | null = this.shape) {
    this.timers.push(setTimeout(() => { this.shape = shape; }, Math.max(0, delayMs)));
    for (const ev of barEvents(steps)) {
      const wait = delayMs + ev.t;
      if (wait < -150) continue;
      this.timers.push(setTimeout(() => { for (const s of ev.strings) this.pluck(s); }, wait));
    }
  }

  reset() {  // picks back to their start side, like the servos
    this.sideB.fill(false);
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  draw() {
    const c = this.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--fg'), muted = css.getPropertyValue('--muted');
    const accent = css.getPropertyValue('--accent'), line = css.getPropertyValue('--line');

    const left = 34, neckEnd = w * 0.55, fretW = (neckEnd - left) / 5;
    const rowY = (s: number) => 18 + (5 - s) * ((h - 36) / 5);  // high e on top, like tab
    // frets
    g.strokeStyle = line; g.lineWidth = 2;
    for (let f = 0; f <= 5; f++) {
      g.beginPath(); g.moveTo(left + f * fretW, rowY(5) - 8); g.lineTo(left + f * fretW, rowY(0) + 8); g.stroke();
    }
    g.lineWidth = 5; g.beginPath(); g.moveTo(left, rowY(5) - 8); g.lineTo(left, rowY(0) + 8); g.stroke();  // nut
    // pick zone
    const pickX = w * 0.78;
    g.fillStyle = muted; g.font = '12px system-ui'; g.textAlign = 'center';
    g.fillText('picks', pickX, h - 2);

    for (let s = 0; s < 6; s++) {
      const y = rowY(s), e = this.energy[s], fret = this.shape ? this.shape[s] : '0';
      // string, wobbling while it rings
      g.strokeStyle = e > 0.02 ? accent : fg;
      g.lineWidth = 1 + (5 - s) * 0.35 + e * 1.5;
      g.beginPath();
      for (let x = left; x <= w - 8; x += 4) {
        const amp = e * 4 * Math.sin(((x - left) / (w - left)) * Math.PI);
        g.lineTo(x, y + amp * Math.sin(x * 0.3 + performance.now() * 0.08));
      }
      g.stroke();
      // string name, muted mark, finger dot
      g.fillStyle = muted; g.textAlign = 'right'; g.fillText(fret === 'x' ? '×' : NAMES[s], left - 10, y + 4);
      if (fret !== 'x' && fret !== '0') {
        g.fillStyle = accent; g.beginPath(); g.arc(left + (Number(fret) - 0.5) * fretW, y, 7, 0, 7); g.fill();
      }
      // pick: a small triangle on whichever side of the string the servo left it
      const py = y + (this.sideB[s] ? 9 : -9);
      g.fillStyle = e > 0.02 ? accent : muted;
      g.beginPath(); g.moveTo(pickX - 6, py); g.lineTo(pickX + 6, py); g.lineTo(pickX, py + (this.sideB[s] ? 7 : -7)); g.fill();
      this.energy[s] *= 0.93;
    }
    this.frame = requestAnimationFrame(() => this.draw());
  }
}
