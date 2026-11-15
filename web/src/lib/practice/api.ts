// The practice coach's routes on the board (servo-strummer/python/main.py).
import { api, type Result } from '../api';
import type { Accuracy, Grade } from './grade';

export interface SongInfo { id: string; name: string; chords: string[]; pattern: string; bpm: number }

export interface Progress {
  songs: Record<string, { best: number; last: number; history: { at: number; score: number; bpm: number }[] }>;
  chords: Record<string, Accuracy>;
  changes: Record<string, Accuracy>;
  hardest: ({ change: string } & Accuracy)[];
  recent: { id: number; started: number; song: string; bpm: number; score: number }[];
}

export const songs = () => api<{ songs?: SongInfo[] }>('GET', '/songs').then(r => r.songs || []);
export const progress = () => api<Progress>('GET', '/progress');
export const saveSession = (song: string, bpm: number, results: [string, Grade][]) =>
  api<Result & { session?: { score: number } }>('POST', '/sessions', { song, bpm, results: results.map(([c, g]) => `${c}:${g}`).join(',') });
