// In-memory record of recent pipeline runs for the protocol view.
// Holds step codes only — never student text. Cleared when the server restarts.
export interface TraceStep {
  step: "session" | "crisis_phrase" | "classifier" | "validate" | "policy";
  status: "pass" | "hit" | "skipped" | "fail";
  detail: string;
  ms?: number;
}
export interface DemoRun {
  at: number;
  checkin: string;          // short id
  kind: "respond" | "clarify";
  steps: TraceStep[];
  outcome: string;          // e.g. "skill:PRIORITIZE", "help", "clarify"
}

const MAX = 20;
const runs: DemoRun[] = [];

export function recordRun(run: DemoRun) {
  runs.unshift(run);
  if (runs.length > MAX) runs.length = MAX;
}
export const recentRuns = () => runs.slice();
export const clearRuns = () => { runs.length = 0; };
