// Types for eleven.js (Ray's module, kept verbatim as plain JS).

export const DEFAULT_VOICE: string;
export function transcribe(key: string, blob: Blob, keyterms?: string[]): Promise<string>;
export function tts(key: string, voice: string, text: string): Promise<string>;
export function voices(key: string): Promise<{ id: string; name: string }[]>;

export class Speaker {
  speaking: boolean;
  play(url: string): Promise<void>;
}

export interface Clip { blob: Blob; ms: number }

export class VoiceMic {
  stream: MediaStream | null;
  open(): Promise<void>;
  level(): number;
  readonly recording: boolean;
  start(): void;
  stop(): Promise<Clip | null>;
}

export class SpeechGate {
  open: boolean;
  tick(level: number, gate: number): 'start' | 'end' | null;
}
