// Chord-shape recognition maths for the camera (no DOM, so tests can run it in Node).

// A chord is how the fingers sit relative to the hand, so each frame becomes the finger joints
// in the hand's own frame: origin at the index knuckle, x along the knuckle line, scaled by
// knuckle width. Tilting the guitar or moving closer then barely changes the numbers.
const FINGER_POINTS = [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20];  // thumb..pinky joints + tips

// lm: 21 MediaPipe landmarks {x, y, z} (x, y as fractions of the frame); aspect = width / height
export function features(lm, aspect) {
  const P = i => ({ x: lm[i].x * aspect, y: lm[i].y, z: lm[i].z * aspect });  // undo frame squash
  const o = P(5), k = P(17);
  const ax = k.x - o.x, ay = k.y - o.y, s = Math.hypot(ax, ay) || 1;
  const ux = ax / s, uy = ay / s;
  const f = [];
  for (const i of FINGER_POINTS) {
    const p = P(i), dx = p.x - o.x, dy = p.y - o.y;
    f.push((dx * ux + dy * uy) / s, (dy * ux - dx * uy) / s, (p.z - o.z) / s);
  }
  return f;
}

// Scale every feature by its spread over the recordings, so no single noisy joint dominates.
export function buildIndex(samples) {
  const all = Object.values(samples).flat();
  if (!all.length) return { norm: null, zSamples: [] };
  const n = all[0].length, mean = Array(n).fill(0), sd = Array(n).fill(0);
  for (const v of all) for (let i = 0; i < n; i++) mean[i] += v[i] / all.length;
  for (const v of all) for (let i = 0; i < n; i++) sd[i] += (v[i] - mean[i]) ** 2 / all.length;
  const norm = { mean, sd: sd.map(x => Math.sqrt(x) || 1) };
  const zSamples = Object.entries(samples).flatMap(([chord, list]) => list.map(v => [zscore(v, norm), chord]));
  return { norm, zSamples };
}

const zscore = (v, norm) => v.map((x, i) => (x - norm.mean[i]) / norm.sd[i]);

// k-nearest neighbours: the leading chord and its share of the K votes, or null if untrained
export function knn(f, norm, zSamples, K) {
  if (!norm || zSamples.length < K) return null;
  const z = zscore(f, norm);
  const near = zSamples.map(([v, chord]) => {
    let d = 0;
    for (let i = 0; i < z.length; i++) d += (z[i] - v[i]) ** 2;
    return [d, chord];
  }).sort((a, b) => a[0] - b[0]).slice(0, K);
  const votes = {};
  for (const [, c] of near) votes[c] = (votes[c] || 0) + 1;
  const [chord, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return { chord, share: n / K };
}
