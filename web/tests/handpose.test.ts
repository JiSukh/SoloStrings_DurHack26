// handpose.ts (was recognise.js). Ported from tests/recognise_test.mjs.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildIndex, features, knn, type Landmark, type Samples } from '../src/lib/music/handpose';

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 21 random landmarks in "square" units: a made-up chord shape
const shape = (): Landmark[] => Array.from({ length: 21 }, () => ({ x: rand(), y: rand(), z: rand() * 0.2 }));
// place a shape in a 4:3 frame: rotate, scale, shift, then squash x by the aspect ratio
function place(h: Landmark[], angle: number, scale: number, dx: number, dy: number, noise = 0, aspect = 4 / 3) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return h.map(p => {
    const x = (p.x * c - p.y * s) * scale + dx + (rand() - 0.5) * noise;
    const y = (p.x * s + p.y * c) * scale + dy + (rand() - 0.5) * noise;
    return { x: x / aspect, y, z: p.z * scale / aspect };
  });
}

test('features ignore pose; knn tells two shapes apart', () => {
  const A = shape(), B = shape();
  const f0 = features(place(A, 0, 0.3, 0.2, 0.2), 4 / 3);
  const f1 = features(place(A, 0.7, 0.5, 0.4, 0.1), 4 / 3);
  f0.forEach((v, i) => assert.ok(Math.abs(v - f1[i]) < 1e-9, `feature ${i} changed with pose`));

  const samples: Samples = { A: [], B: [] };
  for (let i = 0; i < 40; i++) {
    samples.A.push(features(place(A, rand(), 0.3 + rand() * 0.2, rand() * 0.3, rand() * 0.3, 0.01), 4 / 3));
    samples.B.push(features(place(B, rand(), 0.3 + rand() * 0.2, rand() * 0.3, rand() * 0.3, 0.01), 4 / 3));
  }
  const { norm, zSamples } = buildIndex(samples);
  for (let i = 0; i < 20; i++) {
    assert.equal(knn(features(place(A, rand() * 3, 0.4, 0.2, 0.3, 0.01), 4 / 3), norm, zSamples, 9)?.chord, 'A');
    assert.equal(knn(features(place(B, rand() * 3, 0.4, 0.2, 0.3, 0.01), 4 / 3), norm, zSamples, 9)?.chord, 'B');
  }
  assert.equal(knn(f0, null, [], 9), null);  // untrained
});
