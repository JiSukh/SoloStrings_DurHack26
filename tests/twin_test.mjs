// twin.js: the virtual guitar plays the right notes at the robot's times.
import { noteMidi, barEvents, barLength } from '../servo-strummer/assets/twin.js';
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

// C shape x32010: muted low E, then C3 E3 G3 C4 E4
eq([0, 1, 2, 3, 4, 5].map(s => noteMidi('x32010', s)), [null, 48, 52, 55, 60, 64], 'C chord notes');
eq([0, 1, 2, 3, 4, 5].map(s => noteMidi(null, s)), [40, 45, 50, 55, 59, 64], 'open strings with no chord');

// steps as patterns.py makes them: rests take time but make no event; masks expand to strings
const steps = [[1, 20], [2, 20], [0, 100], [48, 60]];
eq(barEvents(steps), [{ t: 0, strings: [0] }, { t: 20, strings: [1] }, { t: 140, strings: [4, 5] }], 'events');
eq(barLength(steps), 200, 'bar length');
console.log('twin_test: ok');
