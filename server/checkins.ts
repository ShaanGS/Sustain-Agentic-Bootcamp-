// Check-in state machine and the bounded agent loop. Every transition is enforced here, server-side.
//
//   OBSERVE → SAFETY → UNDERSTAND → DECIDE → ACT → END
//
//   ready --start--> in_progress --respond--> offered | clarifying | help_shown
//   clarifying --clarify (re-checks the ORIGINAL response's safety)--> offered | help_shown
//   offered --act--> acting            (the one allowlisted executor runs; idempotent)
//   offered | clarifying | acting --close--> completed
//   ready --skip--> skipped ; any open --end--> abandoned | completed ; timeouts (scheduler.expireStale)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";
import { checkinConfig, helplines, needById, skillById, type CrisisCategory } from "./config.js";
import { expireStale, type CheckinRow } from "./scheduler.js";
import { crisisPhraseMatch } from "./pipeline/crisisPhrase.js";
import { decide, skillForNeed, type Action, type Decision } from "./pipeline/policy.js";
import { EMPTY_CONTEXT } from "./pipeline/classify/schema.js";
import type { Classifier, ClassifyResult } from "./pipeline/classify/types.js";
import { recordRun, updateRun, type TraceStep } from "./demoLog.js";
import { holdForClarify, takeForClarify, dropHeld } from "./ephemeral.js";
import { log } from "./log.js";
import { elapsed, mark } from "./timing.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const getRow = (db: Db, id: string) =>
  db.prepare(`SELECT * FROM checkins WHERE id = ?`).get(id) as CheckinRow | undefined;
const short = (id: string) => id.slice(0, 6);

function authorize(db: Db, id: string, token: unknown, now: number, allowed: string[]): CheckinRow {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (!allowed.includes(row.status)) throw new HttpError(409, `invalid_state:${row.status}`);
  if (typeof token !== "string" || !row.token_hash) throw new HttpError(401, "invalid_session");
  const a = Buffer.from(sha256(token)), b = Buffer.from(row.token_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "invalid_session");
  return row;
}

function issueSession(db: Db, id: string, now: number, fromStatus: "ready" | "in_progress") {
  const token = randomBytes(24).toString("base64url");
  db.prepare(`UPDATE checkins SET status = 'in_progress', started_at = ?, token_hash = ? WHERE id = ? AND status = ?`)
    .run(now, sha256(token), id, fromStatus);
  return {
    token,
    prompt: checkinConfig.prompt,
    prompt_hint: checkinConfig.prompt_hint,
    max_chars: checkinConfig.max_chars,
    expires_at: now + checkinConfig.in_progress_timeout_minutes * 60_000,
  };
}

export function startCheckin(db: Db, id: string, now: number) {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (row.status !== "ready") throw new HttpError(409, `invalid_state:${row.status}`);
  log("checkin.started", { id });
  return issueSession(db, id, now, "ready");
}

/**
 * Session tokens live in one browser tab. Another tab can take over an unanswered check-in:
 * a fresh token replaces the old one and the 15-minute window restarts.
 */
export function resumeCheckin(db: Db, id: string, now: number) {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (row.status !== "in_progress") throw new HttpError(409, `invalid_state:${row.status}`);
  log("checkin.resumed", { id });
  return issueSession(db, id, now, "in_progress");
}

/** Ends an open check-in from any tab. Unanswered -> abandoned; answered -> completed. */
export function endCheckin(db: Db, id: string, now: number) {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (!["in_progress", "clarifying", "offered", "acting"].includes(row.status)) throw new HttpError(409, `invalid_state:${row.status}`);
  const status = row.status === "in_progress" ? "abandoned" : "completed";
  const result = row.status === "acting" ? "stopped" : row.status === "offered" ? "not_started" : null;
  db.prepare(`UPDATE checkins SET status = ?, closed_at = ?, token_hash = NULL, outcome = COALESCE(outcome, 'none'),
    action_result = COALESCE(?, action_result) WHERE id = ?`).run(status, now, result, id);
  dropHeld(id);
  updateRun(short(id), { step: "end", status: "pass", label: "Check-in closed", detail: `ended by the student (${status})` });
  log("checkin.ended", { id, status });
  return { status };
}

// ---------------------------------------------------------------- labels

const actLabel = (a: Action) =>
  a.executor === "FOCUS_TIMER" ? `Focus timer · ${Math.round((a.duration_s ?? 0) / 60)} min`
    : a.executor === "BREATHING_GUIDE" ? `Guided breathing · ${a.duration_s} s`
    : a.executor === "GUIDED_RESET" ? `Guided reset · ${Math.round((a.duration_s ?? 0) / 60)} min`
    : a.executor === "COPY_MESSAGE" ? "Message ready to copy"
    : "Check-in noted";

const outcomeCode = (d: Decision) => (d.action === "skill" ? `skill:${d.skill.id}` : d.action);

function decideStep(d: Decision, ms: number): TraceStep {
  if (d.action === "help") return { step: "decide", status: "hit", label: "HUMAN_HELP", detail: `policy: ${d.reason} → verified human-help route`, ms };
  if (d.action === "skill") return { step: "decide", status: "pass", label: d.skill.id, detail: `needs table: ${d.need_id} → ${d.skill.id} → ${d.act.executor}`, ms };
  return { step: "decide", status: "pass", label: "CLARIFY", detail: "one tap-to-choose question (no free text)", ms };
}

function actStep(d: Decision): TraceStep {
  if (d.action === "help") return { step: "act", status: "pass", label: "Verified support route", detail: "static helpline config shown; no skill; Still contacted no one" };
  if (d.action === "skill") return { step: "act", status: "pending", label: actLabel(d.act), detail: `${d.act.executor} ready — waiting for the student` };
  return { step: "act", status: "skipped", label: "Waiting", detail: "no action until the student chooses" };
}

// ---------------------------------------------------------------- apply

/** Persists the transition and builds the client payload. Context is returned for display only — never stored. */
function apply(db: Db, row: CheckinRow, d: Decision, source: string, now: number) {
  if (d.action === "help") {
    // Terminal immediately: the ordinary flow stops, the session token is burned.
    db.prepare(`UPDATE checkins SET status = 'help_shown', outcome = 'help', skill_id = NULL, executor = NULL,
      classifier_source = ?, token_hash = NULL, closed_at = ? WHERE id = ?`).run(source, now, row.id);
    dropHeld(row.id);
    log("checkin.help_shown", { id: row.id });
    return { route: "help" as const, reason: d.reason, kind: d.kind, helplines, status: "help_shown" };
  }
  if (d.action === "skill") {
    db.prepare(`UPDATE checkins SET status = 'offered', outcome = ?, skill_id = ?, executor = ?, classifier_source = ? WHERE id = ?`)
      .run(d.skill.id === "CLOSE_OK" ? "close_ok" : "skill", d.skill.id, d.act.executor, source, row.id);
    log("checkin.offered", { id: row.id, skill: d.skill.id, executor: d.act.executor, source });
    const { id, title, summary, minutes, next_step, steps } = d.skill;
    return {
      route: "skill" as const,
      need_id: d.need_id,
      understood: d.understood,
      context: d.context,
      skill: { id, title, summary, minutes, next_step, steps },
      action: d.act,
      // kept for older clients
      matched_label: d.understood, selected_action: title,
      status: "offered",
    };
  }
  db.prepare(`UPDATE checkins SET status = 'clarifying', classifier_source = ? WHERE id = ?`).run(source, row.id);
  log("checkin.clarifying", { id: row.id, reason: d.reason });
  return { route: "clarify" as const, reason: d.reason, options: d.options, status: "clarifying" };
}

// ---------------------------------------------------------------- respond

/**
 * OBSERVE → SAFETY → UNDERSTAND → DECIDE. `text` lives in memory only: never persisted, logged or
 * returned. If one clarification is needed it is held in memory (ephemeral.ts) so the clarification
 * can re-check the original response's safety.
 */
export async function respond(db: Db, classifier: Classifier, id: string, token: unknown, text: unknown, now: () => number) {
  const steps: TraceStep[] = [];
  const tStart = mark();
  let t = mark();
  const row = authorize(db, id, token, now(), ["in_progress"]);
  if (typeof text !== "string" || text.trim().length === 0) throw new HttpError(400, "empty_response");
  if (text.length > checkinConfig.max_chars) throw new HttpError(400, "response_too_long");
  steps.push({ step: "trigger", status: "pass", label: row.source === "scheduled" ? "Scheduled check-in" : "Check in now", detail: `created by ${row.source === "scheduled" ? "the server scheduler" : "“Check in now” (same creation path)"}` });
  steps.push({ step: "observe", status: "pass", label: "Response received", detail: "session valid · text held in memory only", ms: elapsed(t) });

  // SAFETY 1 — explicit backstop, before any model call.
  t = mark();
  const explicit = crisisPhraseMatch(text);
  const phraseMs = elapsed(t);
  let result: ClassifyResult | null = null;
  if (explicit) {
    steps.push({ step: "safety", status: "hit", label: "HIGH_RISK · explicit phrase", detail: `reviewed ${explicit === "emergency" ? "emergency" : "self-harm"} phrase matched`, ms: phraseMs });
    steps.push({ step: "model", status: "skipped", label: "Not called", detail: "explicit backstop matched — the model never sees this response" });
  } else {
    // SAFETY 2 + UNDERSTAND — one model call: risk first, then need and short context. Validated, fail-closed.
    result = await classifier.classify(text);
    const ms = Math.round(((result.ms ?? 0) + (result.validate_ms ?? 0)) * 100) / 100;
    const risk = result.ok ? result.risk : "UNCERTAIN";
    steps.push({ step: "safety", status: risk === "HIGH_RISK" ? "hit" : "pass", label: risk === "HIGH_RISK" ? "HIGH_RISK · model" : risk === "SAFE" ? "Clear" : "Uncertain",
      detail: `no explicit phrase · model risk ${risk}${result.ok ? "" : " (fail-closed)"}`, ms: phraseMs });
    steps.push({
      step: "model", status: !result.ok ? "fail" : result.risk === "HIGH_RISK" ? "hit" : "pass", ms,
      label: result.ok ? `${classifier.info.provider} · ${result.risk}` : `${classifier.info.provider} unavailable`,
      detail: result.ok ? `${classifier.info.provider}/${classifier.info.model} · output passed schema + allowlist`
        : `${result.reason} → treated as UNCERTAIN, never SAFE`,
    });
  }

  t = mark();
  const decision = decide(explicit, result);
  const decideMs = elapsed(t);
  steps.push(decision.action === "skill"
    ? { step: "understand", status: "pass", label: decision.understood, detail: `need ${decision.need_id}${decision.context.situation ? " · context extracted (display only, not stored)" : ""}` }
    : { step: "understand", status: "skipped", label: decision.action === "help" ? "Not needed" : "Unclear", detail: decision.action === "help" ? "ordinary flow stopped" : "no single safe need — ask one question" });
  steps.push(decideStep(decision, decideMs));
  steps.push(actStep(decision));
  if (decision.action === "help") steps.push({ step: "end", status: "pass", label: "Check-in closed", detail: "terminal · no skill · no clarification" });

  // A student may have closed or timed out while the model ran.
  const fresh = authorize(db, id, token, now(), ["in_progress"]);
  const source = explicit ? "phrase" : result?.ok ? result.source : "failed";
  const payload = apply(db, fresh, decision, source, now());
  if (decision.action === "clarify") {
    holdForClarify(row.id, { text, risk: result?.ok ? result.risk : "FAILED", context: EMPTY_CONTEXT }, now());
  }
  const total_ms = elapsed(tStart);
  recordRun({ at: now(), checkin: short(row.id), steps, outcome: outcomeCode(decision), total_ms });
  return { ...payload, trace: steps, total_ms };
}

// ---------------------------------------------------------------- clarify

/**
 * One tap from fixed options — never a second free-text round. The ORIGINAL response is re-checked
 * first (explicit backstop + model safety); a benign choice can never downgrade a high-risk response.
 */
export async function clarify(db: Db, classifier: Classifier, id: string, token: unknown, choice: unknown, now: () => number) {
  const tStart = mark();
  const row = authorize(db, id, token, now(), ["clarifying"]);
  if (choice !== "talk_to_person" && !(typeof choice === "string" && needById(choice))) throw new HttpError(400, "invalid_choice");
  const held = takeForClarify(row.id, now());
  if (!held) {
    // Fail closed: without the original response its safety can't be re-checked, so no skill is offered.
    db.prepare(`UPDATE checkins SET status = 'abandoned', closed_at = ?, token_hash = NULL WHERE id = ?`).run(now(), row.id);
    throw new HttpError(409, "clarify_context_lost");
  }

  let t = mark();
  const explicit: CrisisCategory | null = crisisPhraseMatch(held.text);
  let recheck: ClassifyResult | null = null;
  if (!explicit) recheck = await classifier.classify(held.text);
  const recheckMs = elapsed(t);
  const highRisk = !!explicit || held.risk === "HIGH_RISK" || (recheck?.ok === true && recheck.risk === "HIGH_RISK");

  let decision: Decision;
  if (highRisk) decision = { action: "help", reason: "recheck_high_risk", kind: explicit === "emergency" ? "emergency" : "support" };
  else if (choice === "talk_to_person") decision = { action: "help", reason: "student_asked_for_person", kind: "support" };
  else decision = skillForNeed(choice as string, EMPTY_CONTEXT);

  t = mark();
  const steps: TraceStep[] = [
    { step: "safety", status: highRisk ? "hit" : "pass", label: highRisk ? "HIGH_RISK · re-check" : "Re-checked · clear", ms: recheckMs,
      detail: `original response re-checked before using the choice${explicit ? " · explicit phrase" : recheck?.ok ? ` · model ${recheck.risk}` : " · model unavailable"}` },
    decision.action === "skill"
      ? { step: "understand", status: "pass", label: `Chosen: ${decision.understood}`, detail: `student picked ${decision.need_id}` }
      : { step: "understand", status: "skipped", label: highRisk ? "Choice ignored" : "Asked for a person", detail: highRisk ? "a benign choice cannot downgrade a high-risk response" : "student chose human support" },
    decideStep(decision, elapsed(t)),
    actStep(decision),
  ];
  if (decision.action === "help") steps.push({ step: "end", status: "pass", label: "Check-in closed", detail: "terminal · no skill" });
  for (const s of steps) updateRun(short(row.id), s, outcomeCode(decision));

  const payload = apply(db, row, decision, "clarified", now());
  return { ...payload, trace: steps, total_ms: elapsed(tStart) };
}

// ---------------------------------------------------------------- act

/**
 * ACT: starts the one allowlisted executor the policy attached to this check-in. Idempotent — a
 * repeated call returns the same running action instead of starting a second one. Parameters come
 * only from reviewed config; nothing here can reach the network, files or any other tool.
 */
export function actCheckin(db: Db, id: string, token: unknown, now: number) {
  const row = authorize(db, id, token, now, ["offered", "acting"]);
  const skill = row.skill_id ? skillById(row.skill_id) : undefined;
  if (!skill || skill.executor.type !== row.executor) throw new HttpError(409, "no_executor");
  if (row.status === "acting") {
    return { status: "acting", executor: row.executor, started_at: row.action_started_at, ends_at: row.action_ends_at, already_running: true };
  }
  const ends = now + (skill.executor.duration_s ?? 0) * 1000;
  const changed = db.prepare(`UPDATE checkins SET status = 'acting', action_started_at = ?, action_ends_at = ? WHERE id = ? AND status = 'offered'`)
    .run(now, ends, id);
  if (Number(changed.changes) !== 1) throw new HttpError(409, "invalid_state:acting");
  const label = skill.executor.type === "COPY_MESSAGE" ? "Message copied by the student" : skill.executor.type === "ACKNOWLEDGE" ? "Noted" : `${skill.executor.label} started`;
  updateRun(short(id), { step: "act", status: "pass", label, detail: `${skill.executor.type} started by the student` }, `act:${skill.executor.type}`);
  log("checkin.action_started", { id, executor: skill.executor.type });
  return { status: "acting", executor: skill.executor.type, started_at: now, ends_at: ends, already_running: false };
}

// ---------------------------------------------------------------- close

const RESULTS: Record<string, string[]> = {
  FOCUS_TIMER: ["completed", "stopped"], BREATHING_GUIDE: ["completed", "stopped"], GUIDED_RESET: ["completed", "stopped"],
  COPY_MESSAGE: ["copied"], ACKNOWLEDGE: ["acknowledged"],
};

export function closeCheckin(db: Db, id: string, token: unknown, now: number, result?: unknown) {
  const row = authorize(db, id, token, now, ["offered", "clarifying", "acting"]);
  let actionResult: string | null = null;
  if (row.status === "acting") {
    const allowed = RESULTS[row.executor ?? ""] ?? [];
    actionResult = typeof result === "string" && allowed.includes(result) ? result : allowed[0] === "completed" ? "stopped" : allowed[0] ?? null;
  } else if (row.status === "offered") {
    actionResult = "not_started";
  }
  db.prepare(`UPDATE checkins SET status = 'completed', closed_at = ?, token_hash = NULL,
    outcome = COALESCE(outcome, 'none'), action_result = ? WHERE id = ?`).run(now, actionResult, id);
  dropHeld(id);
  if (actionResult === "not_started") updateRun(short(id), { step: "act", status: "skipped", label: "Not started", detail: "student closed without running the action" });
  else if (actionResult) updateRun(short(id), { step: "act", status: "pass", label: `${row.executor} · ${actionResult}`, detail: "executor finished" });
  updateRun(short(id), { step: "end", status: "pass", label: "Check-in closed", detail: actionResult ? `action ${actionResult}` : "closed without a step" }, `closed:${actionResult ?? "none"}`);
  log("checkin.completed", { id, action: actionResult ?? "none" });
  return { status: "completed", action_result: actionResult };
}

export function skipCheckin(db: Db, id: string, now: number) {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (row.status !== "ready") throw new HttpError(409, `invalid_state:${row.status}`);
  db.prepare(`UPDATE checkins SET status = 'skipped', closed_at = ?, outcome = 'none' WHERE id = ?`).run(now, id);
  log("checkin.skipped", { id });
  return { status: "skipped" };
}
