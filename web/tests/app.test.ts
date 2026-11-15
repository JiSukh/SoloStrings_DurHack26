// @vitest-environment jsdom
// Smoke test of the real page: mount App in jsdom against a fake board and click through the
// main controls. Catches components that fail to render or send the wrong request.
import { flushSync, mount, tick } from 'svelte';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

const handlers: Record<string, (...a: unknown[]) => void> = {};
vi.mock('socket.io-client', () => ({ io: () => ({ on: (ev: string, fn: (...a: unknown[]) => void) => { handlers[ev] = fn; } }) }));

const calls: string[] = [];
const state = {
  playing: null as string | null, chord: null as string | null, bpm: 90, knob_bpm: null, bar: null, song: null as string[] | null,
  servos: true, angles: Array.from({ length: 6 }, () => [60, 120]), now: 0,
};
vi.stubGlobal('fetch', async (url: string, init: { method: string }) => {
  calls.push(`${init.method} ${url}`);
  const path = url.split('?')[0];
  const body: Record<string, unknown> = {
    '/patterns': { patterns: ['Strum', 'Travis picking', 'Random'] },
    '/chords': { chords: { C: 'x32010', G: '320003' } },
    '/status': state,
    '/config': { elevenlabs_key: '' },
  };
  return { json: async () => body[path] ?? { ok: true } };
});
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});

let target: HTMLElement;
const settle = async () => { for (let i = 0; i < 5; i++) { await tick(); await new Promise(r => setTimeout(r, 0)); } flushSync(); };
const button = (text: string, scope = 'main > section:not([hidden])') => {
  const b = [...target.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(x => x.textContent?.trim() === text || x.firstChild?.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}" in: ${[...target.querySelectorAll('button')].map(x => x.textContent?.trim()).join(' | ')}`);
  return b;
};

beforeAll(async () => {
  localStorage.clear();
  target = document.createElement('div');
  document.body.append(target);
  const { default: App } = await import('../src/App.svelte');
  mount(App, { target });
  await settle();
});
afterAll(() => target.remove());

test('renders every section from the board lists', () => {
  const text = target.textContent || '';
  for (const h of ['Virtual guitar', 'Pattern', 'Tempo', 'Chord', 'Chord by ear', 'Chord camera', 'String test', 'Calibrate picks'])
    expect(text).toContain(h);
  expect(button('Travis picking')).toBeTruthy();
  expect(button('G')).toBeTruthy();
  expect(target.querySelectorAll('.calib input[type=range]')).toHaveLength(12);  // 6 strings x 2 sides
  // no voice tab without a key; no /status polling
  expect([...target.querySelectorAll('nav button')].map(b => b.textContent)).toEqual(['Play', 'Practice', 'Progress', 'Setup']);
  expect(calls.filter(c => c.startsWith('GET /status'))).toHaveLength(1);
});

test('buttons send the same requests as the old page', async () => {
  calls.length = 0;
  button('Travis picking').click();
  button('Play').click();
  button('G').click();
  button('Low E', 'main').click();  // on the Setup tab
  await settle();
  expect(calls).toEqual(['POST /play?pattern=Travis+picking', 'POST /chord?name=G', 'POST /pluck?string=0']);
});

test('pushed state updates the page', async () => {
  handlers.state({ ...state, playing: 'Travis picking', chord: 'G', knob_bpm: 120 });
  await settle();
  const text = target.textContent || '';
  expect(text).toContain('Switch pattern');
  expect(text).toContain('120');
  expect(text).toContain('knob');
  expect((target.querySelector('input[aria-label="Tempo in BPM"]') as HTMLInputElement).disabled).toBe(true);
  expect(button('G').getAttribute('aria-pressed')).toBe('true');
});

test('debug mode shows a badge; setup and placeholder tabs switch', async () => {
  handlers.state({ ...state, servos: false });
  await settle();
  expect(target.textContent).toContain('debug mode: servos off');
  button('Setup', 'nav').click();
  await settle();
  const sections = [...target.querySelectorAll<HTMLElement>("main > section")];
  expect(sections.filter(s => !s.hidden).map(s => s.querySelector('h2')?.textContent)).toEqual(['String test']);
  expect((target.querySelector('.debug input') as HTMLInputElement).checked).toBe(true);
});

test('saving a key adds the Voice tab and loads the plugin', async () => {
  const input = target.querySelector('input[aria-label="ElevenLabs API key"]') as HTMLInputElement;
  input.value = 'test-key';
  input.dispatchEvent(new Event('input'));
  button('Save').click();
  await settle();
  await vi.waitFor(() => expect([...target.querySelectorAll('nav button')].map(b => b.textContent)).toContain('Voice'));
  await vi.waitFor(() => expect(target.textContent).toContain('Hold to talk'));
});
