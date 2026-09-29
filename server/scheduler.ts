// Server-side scheduler. The same createDueCheckin() is used by the timer tick
// and by "Check in now", so the demo exercises the real creation path.
import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";
import { checkinConfig } from "./config.js";
import { computeNextDue, type Cadence } from "./time.js";
import { log } from "./log.js";

export const OPEN_STATUSES = ["ready", "in_progress", "clarifying", "offered"] as const;
const OPEN_SQL = `('ready','in_progress','clarifying','offered')`;

export interface ScheduleRow {
  cadence: Cadence; time_local: string; timezone: string;
  enabled: number; next_due_at: number | null; updated_at: number;
}
export interface CheckinRow {
  id: string; source: "scheduled" | "manual"; status: string;
  created_at: number; due_at: number; expires_at: number;
  started_at: number | null; closed_at: number | null; token_hash: string | null;
  outcome: string | null; skill_id: string | null; classifier_source: string | null;
}

export const getSchedule = (db: Db) =>
  db.prepare(`SELECT cadence, time_local, timezone, enabled, next_due_at, updated_at FROM schedule WHERE id = 1`)
    .get() as ScheduleRow | undefined;

export const getOpenCheckin = (db: Db) =>
  db.prepare(`SELECT * FROM checkins WHERE status IN ${OPEN_SQL} ORDER BY created_at DESC LIMIT 1`)
    .get() as CheckinRow | undefined;

export function saveSchedule(
  db: Db,
  input: { cadence: Cadence; time_local: string; timezone: string; enabled: boolean; first_due_in_seconds?: number },
  now: number,
) {
  const next = !input.enabled ? null
    : input.first_due_in_seconds ? now + input.first_due_in_seconds * 1000
    : computeNextDue(input.cadence, input.time_local, input.timezone, now);
  db.prepare(`
    INSERT INTO schedule (id, cadence, time_local, timezone, enabled, next_due_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET cadence = excluded.cadence, time_local = excluded.time_local,
      timezone = excluded.timezone, enabled = excluded.enabled,
      next_due_at = excluded.next_due_at, updated_at = excluded.updated_at
  `).run(input.cadence, input.time_local, input.timezone, input.enabled ? 1 : 0, next, now);
  log("schedule.saved", { cadence: input.cadence, enabled: input.enabled, next_due_at: next ?? "none" });
  return getSchedule(db)!;
}

/** Closes check-ins whose window has passed. */
export function expireStale(db: Db, now: number) {
  const timeout = checkinConfig.in_progress_timeout_minutes * 60_000;
  const expired = db.prepare(`UPDATE checkins SET status = 'expired', closed_at = ?, token_hash = NULL, outcome = 'none'
    WHERE status = 'ready' AND expires_at <= ?`).run(now, now);
  const abandoned = db.prepare(`UPDATE checkins SET status = 'abandoned', closed_at = ?, token_hash = NULL,
      outcome = COALESCE(outcome, 'none')
    WHERE status IN ('in_progress','clarifying','offered') AND started_at <= ?`).run(now, now - timeout);
  if (Number(expired.changes) || Number(abandoned.changes)) {
    log("checkins.expired", { expired: Number(expired.changes), abandoned: Number(abandoned.changes) });
  }
}

/**
 * Creates a due check-in in `ready` state. If one is already open, returns it
 * instead, so there is never more than one open check-in.
 */
export function createDueCheckin(db: Db, source: "scheduled" | "manual", now: number): { checkin: CheckinRow; created: boolean } {
  db.exec("BEGIN IMMEDIATE");
  try {
    expireStale(db, now);
    const open = getOpenCheckin(db);
    if (open) { db.exec("COMMIT"); return { checkin: open, created: false }; }
    const id = randomBytes(9).toString("base64url");
    const expires = now + checkinConfig.ready_window_minutes * 60_000;
    db.prepare(`INSERT INTO checkins (id, source, status, created_at, due_at, expires_at)
      VALUES (?, ?, 'ready', ?, ?, ?)`).run(id, source, now, now, expires);
    db.exec("COMMIT");
    log("checkin.ready", { id, source });
    return { checkin: getOpenCheckin(db)!, created: true };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** One scheduler pass. Safe to call at any frequency. */
export function tick(db: Db, now: number) {
  expireStale(db, now);
  const s = getSchedule(db);
  if (!s || !s.enabled || s.next_due_at == null || now < s.next_due_at) return { fired: false };
  const result = createDueCheckin(db, "scheduled", now);
  // Missed slots (e.g. laptop asleep) collapse into this one check-in.
  const next = computeNextDue(s.cadence, s.time_local, s.timezone, now);
  db.prepare(`UPDATE schedule SET next_due_at = ? WHERE id = 1`).run(next);
  log("scheduler.fired", { created: result.created, next_due_at: next });
  return { fired: true, created: result.created };
}

export function startScheduler(db: Db, tickMs: number, clock: () => number = Date.now) {
  const run = () => { try { tick(db, clock()); } catch (e) { log("scheduler.error", { name: (e as Error).name }); } };
  run();
  const handle = setInterval(run, tickMs);
  handle.unref();
  return () => clearInterval(handle);
}
