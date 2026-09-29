// Check-in state machine. Every transition is enforced here, server-side.
//
//   ready --start--> in_progress --respond--> offered | clarifying | help_shown
//   clarifying --clarify--> offered | help_shown
//   offered | clarifying --close--> completed
//   ready --skip--> skipped ; timeouts -> expired | abandoned (see scheduler.expireStale)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";
import { checkinConfig, helplines, needById } from "./config.js";
import { expireStale, type CheckinRow } from "./scheduler.js";
import { crisisPhraseHit } from "./pipeline/crisisPhrase.js";
import { decide, skillForNeed, type Decision } from "./pipeline/policy.js";
import type { Classifier } from "./pipeline/classify/types.js";
import { recordRun, type TraceStep } from "./demoLog.js";
import { log } from "./log.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const getRow = (db: Db, id: string) =>
  db.prepare(`SELECT * FROM checkins WHERE id = ?`).get(id) as CheckinRow | undefined;

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

export function startCheckin(db: Db, id: string, now: number) {
  expireStale(db, now);
  const row = getRow(db, id);
  if (!row) throw new HttpError(404, "checkin_not_found");
  if (row.status !== "ready") throw new HttpError(409, `invalid_state:${row.status}`);
  const token = randomBytes(24).toString("base64url");
  db.prepare(`UPDATE checkins SET status = 'in_progress', started_at = ?, token_hash = ? WHERE id = ? AND status = 'ready'`)
    .run(now, sha256(token), id);
  log("checkin.started", { id });
  return {
    token,
    prompt: checkinConfig.prompt,
    prompt_hint: checkinConfig.prompt_hint,
    max_chars: checkinConfig.max_chars,
    expires_at: now + checkinConfig.in_progress_timeout_minutes * 60_000,
  };
}

/** Converts a policy decision to the client payload and persists the transition. */
function apply(db: Db, row: CheckinRow, d: Decision, source: string, now: number) {
  if (d.action === "help") {
    // Terminal immediately: the ordinary flow stops, the session token is burned.
    db.prepare(`UPDATE checkins SET status = 'help_shown', outcome = 'help', skill_id = NULL,
      classifier_source = ?, token_hash = NULL, closed_at = ? WHERE id = ?`).run(source, now, row.id);
    log("checkin.help_shown", { id: row.id });
    return { route: "help" as const, reason: d.reason, helplines, status: "help_shown" };
  }
  if (d.action === "skill") {
    db.prepare(`UPDATE checkins SET status = 'offered', outcome = ?, skill_id = ?, classifier_source = ? WHERE id = ?`)
      .run(d.skill.id === "CLOSE_OK" ? "close_ok" : "skill", d.skill.id, source, row.id);
    log("checkin.offered", { id: row.id, skill: d.skill.id, source });
    return {
      route: "skill" as const, need_id: d.need_id, matched_label: d.matched_label,
      selected_action: d.skill.title, skill: d.skill, status: "offered",
    };
  }
  db.prepare(`UPDATE checkins SET status = 'clarifying', classifier_source = ? WHERE id = ?`).run(source, row.id);
  log("checkin.clarifying", { id: row.id, reason: d.reason });
  return { route: "clarify" as const, reason: d.reason, options: d.options, status: "clarifying" };
}

const outcomeCode = (d: Decision) =>
  d.action === "skill" ? `skill:${d.skill.id}` : d.action;

/**
 * The pipeline: session -> crisis phrase -> classify -> validate -> policy.
 * `text` is used in memory only: it is never persisted, logged or returned.
 */
export async function respond(db: Db, classifier: Classifier, id: string, token: unknown, text: unknown, now: () => number) {
  const steps: TraceStep[] = [];
  const row = authorize(db, id, token, now(), ["in_progress"]);
  if (typeof text !== "string" || text.trim().length === 0) throw new HttpError(400, "empty_response");
  if (text.length > checkinConfig.max_chars) throw new HttpError(400, "response_too_long");
  steps.push({ step: "session", status: "pass", detail: "Check-in open, session token valid" });

  let decision: Decision;
  let source: string;
  if (crisisPhraseHit(text)) {
    steps.push({ step: "crisis_phrase", status: "hit", detail: "Reviewed crisis phrase matched" });
    steps.push({ step: "classifier", status: "skipped", detail: "Not called — ordinary flow stopped" });
    decision = decide(true, null);
    source = "phrase";
  } else {
    steps.push({ step: "crisis_phrase", status: "pass", detail: "No reviewed crisis phrase" });
    const result = await classifier.classify(text);
    steps.push({
      step: "classifier", status: result.ok ? "pass" : "fail", ms: result.ms,
      detail: result.ok ? `${classifier.info.provider}/${classifier.info.model} → ${result.classification}`
        : `${classifier.info.provider} unavailable (${result.reason}) → treated as UNCERTAIN`,
    });
    steps.push({
      step: "validate", status: result.ok ? "pass" : "fail",
      detail: result.ok ? (result.classification === "ORDINARY" ? `need "${result.need_id}" is on the allowlist` : "valid label")
        : "no valid output — never defaults to ORDINARY",
    });
    decision = decide(false, result);
    source = result.ok ? result.source : "failed";
  }
  steps.push({ step: "policy", status: "pass", detail: policyDetail(decision) });

  // A student may have closed or timed out while the classifier ran.
  const fresh = authorize(db, id, token, now(), ["in_progress"]);
  const payload = apply(db, fresh, decision, source, now());
  recordRun({ at: now(), checkin: row.id.slice(0, 6), kind: "respond", steps, outcome: outcomeCode(decision) });
  return { ...payload, trace: steps };
}

function policyDetail(d: Decision) {
  if (d.action === "help") return "Route to human help (static helpline config)";
  if (d.action === "skill") return `needs table: ${d.need_id} → ${d.skill.id}`;
  return "Ask one clarifying choice (no free text)";
}

/** Clarification is a single tap from fixed options — never a second free-text round. */
export function clarify(db: Db, id: string, token: unknown, choice: unknown, now: number) {
  const row = authorize(db, id, token, now, ["clarifying"]);
  let decision: Decision;
  if (choice === "talk_to_person") decision = { action: "help", reason: "student_asked_for_person" };
  else if (typeof choice === "string" && needById(choice)) decision = skillForNeed(choice);
  else throw new HttpError(400, "invalid_choice");
  const steps: TraceStep[] = [
    { step: "session", status: "pass", detail: "Check-in open, session token valid" },
    { step: "policy", status: "pass", detail: decision.action === "help" ? "Student asked for a person → human help" : policyDetail(decision) },
  ];
  const payload = apply(db, row, decision, "clarified", now);
  recordRun({ at: now, checkin: row.id.slice(0, 6), kind: "clarify", steps, outcome: outcomeCode(decision) });
  return { ...payload, trace: steps };
}

export function closeCheckin(db: Db, id: string, token: unknown, now: number) {
  authorize(db, id, token, now, ["offered", "clarifying"]);
  db.prepare(`UPDATE checkins SET status = 'completed', closed_at = ?, token_hash = NULL,
    outcome = COALESCE(outcome, 'none') WHERE id = ?`).run(now, id);
  log("checkin.completed", { id });
  return { status: "completed" };
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
