// Types for voice.js (Ray's module, kept verbatim as plain JS).
import type { Command } from './commands';

export function spokenChord(name: string): string;
export function chordHelp(name: string, shape: string): string;
export function normalise(text: string): string;
export function stripWake(text: string, wake?: string[]): string | null;
export function patternWords(name: string): string[];
export const SONGS: { name: string; match: RegExp; chords: string[] }[];
export function parseCommand(text: string, lists?: { patterns?: string[]; chords?: string[] }): Command | null;
export function keyterms(patterns: string[], chords: string[]): string[];
