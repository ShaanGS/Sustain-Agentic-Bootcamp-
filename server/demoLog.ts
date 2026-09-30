// Agent trace of recent check-ins for the protocol view, kept in the store so it survives across
// serverless instances. Holds step codes and reviewed labels only — never student text or context.
import type { Store } from "./store.js";

export type StepName = "trigger" | "observe" | "safety" | "model" | "understand" | "decide" | "act" | "end";
export interface TraceStep {
  step: StepName;
  status: "pass" | "hit" | "skipped" | "fail" | "pending";
  /** Short observable label, e.g. "Clear", "PRIORITIZE", "Focus timer · 15 min". */
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

const KEEP = 20;

export async function recordRun(db: Store, run: DemoRun) {
  await db.run(`INSERT INTO agent_runs (checkin, at, steps, outcome, total_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(checkin) DO UPDATE SET at = excluded.at, steps = excluded.steps, outcome = excluded.outcome, total_ms = excluded.total_ms`,
    [run.checkin, run.at, JSON.stringify(run.steps), run.outcome, run.total_ms]);
  await db.run(`DELETE FROM agent_runs WHERE checkin NOT IN (SELECT checkin FROM agent_runs ORDER BY at DESC LIMIT ${KEEP})`);
}

/** Adds or replaces steps on an existing run (e.g. ACT started, END). */
export async function updateRun(db: Store, checkin: string, steps: TraceStep[], outcome?: string) {
  const row = await db.get<{ steps: string; outcome: string }>(`SELECT steps, outcome FROM agent_runs WHERE checkin = ?`, [checkin]);
  if (!row) return;
  const list = JSON.parse(row.steps) as TraceStep[];
  for (const step of steps) {
    const i = list.findIndex((s) => s.step === step.step);
    if (i >= 0) list[i] = step; else list.push(step);
  }
  await db.run(`UPDATE agent_runs SET steps = ?, outcome = ? WHERE checkin = ?`, [JSON.stringify(list), outcome ?? row.outcome, checkin]);
}

export async function recentRuns(db: Store): Promise<DemoRun[]> {
  const rows = await db.all<{ checkin: string; at: number; steps: string; outcome: string; total_ms: number }>(
    `SELECT checkin, at, steps, outcome, total_ms FROM agent_runs ORDER BY at DESC LIMIT ${KEEP}`);
  return rows.map((r) => ({ ...r, total_ms: Number(r.total_ms), steps: JSON.parse(r.steps) as TraceStep[] }));
}
