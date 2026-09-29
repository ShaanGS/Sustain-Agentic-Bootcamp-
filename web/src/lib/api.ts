// Typed client for the Still API. Every screen reads from these calls; nothing is mocked.
export interface HelplineNumber { display: string; tel: string }
export interface Helpline { id: string; name: string; description: string; numbers: HelplineNumber[]; source_url: string; verified_on: string; verified_by: string }
export interface Helplines { primary: Helpline; emergency: Helpline }
export interface ClassifierInfo { provider: "groq" | "ollama" | "local"; model: string; sends_text_off_machine: boolean; destination: string }
export type Cadence = "daily" | "weekdays";
export interface Schedule { cadence: Cadence; time_local: string; timezone: string; enabled: boolean; next_due_at: number | null }
export type CheckinStatus = "ready" | "in_progress" | "clarifying" | "offered" | "completed" | "help_shown" | "expired" | "skipped" | "abandoned";
export interface OpenCheckin { id: string; status: CheckinStatus; source: "scheduled" | "manual"; due_at: number; expires_at: number; started_at: number | null; closes_at: number }
export interface AppState {
  now: number;
  schedule: Schedule | null;
  scheduler: { runs_on: string; tick_seconds: number; notifications: string };
  open_checkin: OpenCheckin | null;
  last_checkin: { status: CheckinStatus; outcome: string | null; closed_at: number | null; skill_title: string | null } | null;
  classifier: ClassifierInfo;
  helplines: Helplines;
}
export interface StartResult { token: string; prompt: string; prompt_hint: string; max_chars: number; expires_at: number }
export interface TraceStep { step: "session" | "crisis_phrase" | "classifier" | "validate" | "policy"; status: "pass" | "hit" | "skipped" | "fail"; detail: string; ms?: number }
export interface Skill { id: string; title: string; summary: string; minutes: number; steps: string[] }
export type RouteResult =
  | { route: "skill"; need_id: string; matched_label: string; selected_action: string; skill: Skill; status: "offered"; trace: TraceStep[]; total_ms: number }
  | { route: "clarify"; reason: "uncertain" | "classifier_failed"; options: { need_id: string; label: string }[]; status: "clarifying"; trace: TraceStep[]; total_ms: number }
  | { route: "help"; reason: "crisis_phrase" | "classifier_crisis" | "student_asked_for_person"; helplines: Helplines; status: "help_shown"; trace: TraceStep[]; total_ms: number };

export interface Protocol {
  pipeline: { step: string; text: string }[];
  prompt: string;
  needs: { id: string; label: string; skill_id: string }[];
  skills: { id: string; title: string; summary: string }[];
  skills_review: { reviewed_by: string; reviewed_on: string };
  crisis_phrases: { count: number; reviewed_on: string };
  helplines: Helplines;
  classifier: ClassifierInfo;
  storage: { where: string; what: string; text_stored: boolean | null }[];
  disclosures: string[];
  recent_runs: { at: number; checkin: string; kind: "respond" | "clarify"; steps: TraceStep[]; outcome: string; total_ms: number }[];
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
  close: (id: string, token: string) => call<{ status: string }>("POST", `/checkins/${id}/close`, { token }),
  skip: (id: string) => call<{ status: string }>("POST", `/checkins/${id}/skip`),
};
