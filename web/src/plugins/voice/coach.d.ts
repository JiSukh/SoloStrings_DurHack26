// Types for coach.js (Ray's module, kept verbatim as plain JS).

export interface CoachTool { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } }
export function coachTools(patterns: string[], chords: string[]): CoachTool[];
export function coachPrompt(patterns: string[], chords: string[]): string;
export function createCoach(key: string, opts: { voice: string; patterns: string[]; chords: string[] }): Promise<string>;

export interface CoachSession { endSession(): Promise<void> }
export function startCoach(opts: {
  key: string;
  agentId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (params: any) => unknown>;
  on: { message(text: string, who: string): void; status(text: string): void; error(text: string): void };
}): Promise<CoachSession>;
