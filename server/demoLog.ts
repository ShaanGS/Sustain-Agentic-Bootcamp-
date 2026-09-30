// In-memory agent trace of recent check-ins for the protocol view.
// Holds step codes and reviewed labels only — never student text or extracted context.
// Cleared when the server restarts.
export type StepName = "trigger" | "observe" | "safety" | "model" | "understand" | "decide" | "act" | "end";
export interface TraceStep {
  step: StepName;
  status: "pass" | "hit" | "skipped" | "fail" | "pending";
  /** Short observable label, e.g. "Clear", "PRIORITIZE", "FOCUS_TIMER · 15 min". */
  label: string;
  detail: string;
  /** Measured duration in ms. Absent when the step did not run. */
  ms?: number;
}
export interface DemoRun {
  at: number;
  checkin: string;          // short id
  steps: TraceStep[];
  outcome: string;          // e.g. "skill:PRIORITIZE", "help", "clarify"
  total_ms: number;         // measured server time for the respond request
}

const MAX = 20;
const runs: DemoRun[] = [];

export function recordRun(run: DemoRun) {
  const i = runs.findIndex((r) => r.checkin === run.checkin);
  if (i >= 0) runs.splice(i, 1);
  runs.unshift(run);
  if (runs.length > MAX) runs.length = MAX;
}
/** Adds or replaces a step on an existing run (e.g. ACT started, END). */
export function updateRun(checkin: string, step: TraceStep, outcome?: string) {
  const r = runs.find((x) => x.checkin === checkin);
  if (!r) return;
  const i = r.steps.findIndex((s) => s.step === step.step);
  if (i >= 0) r.steps[i] = step; else r.steps.push(step);
  if (outcome) r.outcome = outcome;
}
export const recentRuns = () => runs.map((r) => ({ ...r, steps: r.steps.slice() }));
export const clearRuns = () => { runs.length = 0; };
