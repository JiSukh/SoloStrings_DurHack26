// The real chord shapes and pattern names, read from the Python side (strummer/music.py), so a
// renamed chord or pattern that the page can no longer reach fails these tests.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../servo-strummer/python/strummer/music.py', import.meta.url), 'utf8');

export const CHORDS: Record<string, string> = Object.fromEntries(
  [...src.matchAll(/"([A-G][a-z0-9]*)": "([x0-9]{6})"/g)].map(m => [m[1], m[2]]));
export const patterns = [...src.matchAll(/^ {4}"([^"]+)": \[/gm)].map(m => m[1]).concat('Random');
export const chords = Object.keys(CHORDS);

if (chords.length < 20 || patterns.length < 14) throw new Error('could not read CHORDS / PATTERNS from strummer/music.py');
