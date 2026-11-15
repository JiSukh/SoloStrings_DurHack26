// synth.ts (was twin.js): the virtual guitar plays the right notes at the robot's times.
// Ported from tests/twin_test.mjs.
import { expect, test } from 'vitest';
import { barEvents, barLength, noteMidi, type Step } from '../src/lib/music/synth';

test('notes for a chord shape and for open strings', () => {
  // C shape x32010: muted low E, then C3 E3 G3 C4 E4
  expect([0, 1, 2, 3, 4, 5].map(s => noteMidi('x32010', s))).toEqual([null, 48, 52, 55, 60, 64]);
  expect([0, 1, 2, 3, 4, 5].map(s => noteMidi(null, s))).toEqual([40, 45, 50, 55, 59, 64]);
});

test('steps -> pluck times: rests take time but make no event; masks expand to strings', () => {
  const steps: Step[] = [[1, 20], [2, 20], [0, 100], [48, 60]];
  expect(barEvents(steps)).toEqual([{ t: 0, strings: [0] }, { t: 20, strings: [1] }, { t: 140, strings: [4, 5] }]);
  expect(barLength(steps)).toBe(200);
});
