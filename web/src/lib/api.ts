// Typed client for the Still API. Every screen reads from these calls; nothing is mocked.
export interface HelplineNumber { display: string; tel: string }
export interface Helpline { id: string; name: string; description: string; numbers: HelplineNumber[]; source_url: string; verified_on: string; verified_by: string; tags?: string[] }
export interface Helplines { primary: Helpline; emergency: Helpline }
export interface ClassifierInfo { provider: "groq" | "ollama" | "local"; model: string; sends_text_off_machine: boolean; destination: string }
export type Cadence = "daily" | "weekdays";
export interface Schedule { cadence: Cadence; time_local: string; timezone: string; enabled: boolean; next_due_at: number | null }
export type CheckinStatus = "ready" | "in_progress" | "clarifying" | "offered" | "acting" | "completed" | "help_shown" | "expired" | "skipped" | "abandoned";
export interface OpenCheckin { id: string; status: CheckinStatus; source: "scheduled" | "manual"; due_at: number; expires_at: number; started_at: number | null; closes_at: number }
export interface AppState {
  now: number;
  schedule: Schedule | null;
  scheduler: { runs_on: string; tick_seconds: number; notifications: string };
  open_checkin: OpenCheckin | null;
  last_checkin: { status: CheckinStatus; outcome: string | null; closed_at: number | null; skill_title: string | null; action_label: string | null; action_result: string | null } | null;
  classifier: ClassifierInfo;
  helplines: Helplines;
}
export interface StartResult { token: string; prompt: string; prompt_hint: string; max_chars: number; expires_at: number }
export type StepName = "trigger" | "observe" | "safety" | "model" | "understand" | "decide" | "act" | "end";
export interface TraceStep { step: StepName; status: "pass" | "hit" | "skipped" | "fail" | "pending"; label: string; detail: string; ms?: number }
export interface Skill { id: string; title: string; summary: string; minutes: number; next_step: string; steps: string[] }
export type ExecutorType = "FOCUS_TIMER" | "BREATHING_GUIDE" | "COPY_MESSAGE" | "GUIDED_RESET" | "ACKNOWLEDGE";
/** The one bounded action the server attached. Everything except `target` is reviewed config. */
export interface Action {
  executor: ExecutorType; label: string; cta: string; duration_s?: number; target?: string; message?: string;
  phases?: { label: string; seconds: number }[]; rounds?: number; cues?: string[];
}
export interface Context { situation: string | null; focus_target: string | null; deadline: string | null }
export type RouteResult =
  | { route: "skill"; need_id: string; understood: string; context: Context; skill: Skill; action: Action; status: "offered"; trace: TraceStep[]; total_ms: number }
  | { route: "clarify"; reason: "uncertain" | "classifier_failed"; options: { need_id: string; label: string }[]; status: "clarifying"; trace: TraceStep[]; total_ms: number }
  | { route: "help"; reason: "explicit_phrase" | "model_high_risk" | "recheck_high_risk" | "student_asked_for_person"; kind: "emergency" | "support"; helplines: Helplines; status: "help_shown"; trace: TraceStep[]; total_ms: number };
export interface ActResult { status: "acting"; executor: ExecutorType; started_at: number; ends_at: number; already_running: boolean }

export interface Protocol {
  pipeline: { step: string; text: string }[];
  prompt: string;
  needs: { id: string; label: string; skill_id: string }[];
  skills: { id: string; title: string; summary: string }[];
  skills_review: { reviewed_by: string; reviewed_on: string };
  crisis_phrases: { count: number; self_harm: number; emergency: number; reviewed_on: string };
  executors: { skill_id: string; type: ExecutorType; label: string; duration_s: number | null }[];
  helplines: Helplines;
  classifier: ClassifierInfo;
  storage: { where: string; what: string; text_stored: boolean | null }[];
  disclosures: string[];
  recent_runs: { at: number; checkin: string; steps: TraceStep[]; outcome: string; total_ms: number }[];
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
  /** The check-in moved on server-side (expired, abandoned, already closed). */
  get closed() { return this.status === 409 || this.status === 404; }
  get sessionLost() { return this.status === 401; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "unknown");
  return data as T;
}

export const api = {
  state: () => call<AppState>("GET", "/state"),
  protocol: () => call<Protocol>("GET", "/protocol"),
  saveSchedule: (s: { cadence: Cadence; time_local: string; timezone: string; enabled?: boolean; first_due_in_seconds?: number }) =>
    call<Schedule>("PUT", "/schedule", s),
  checkInNow: () => call<{ checkin: OpenCheckin; created: boolean }>("POST", "/checkins/now"),
  start: (id: string) => call<StartResult>("POST", `/checkins/${id}/start`),
  respond: (id: string, token: string, text: string) => call<RouteResult>("POST", `/checkins/${id}/respond`, { token, text }),
  clarify: (id: string, token: string, choice: string) => call<RouteResult>("POST", `/checkins/${id}/clarify`, { token, choice }),
  act: (id: string, token: string) => call<ActResult>("POST", `/checkins/${id}/act`, { token }),
  close: (id: string, token: string, action_result?: string) => call<{ status: string; action_result: string | null }>("POST", `/checkins/${id}/close`, { token, action_result }),
  skip: (id: string) => call<{ status: string }>("POST", `/checkins/${id}/skip`),
  resume: (id: string) => call<StartResult>("POST", `/checkins/${id}/resume`),
  end: (id: string) => call<{ status: string }>("POST", `/checkins/${id}/end`),
};
