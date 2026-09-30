// Server-side scheduler. The same createDueCheckin() is used by the scheduler tick
// and by "Check in now", so the demo exercises the real creation path.
// Locally the tick runs on an interval; on serverless (Vercel) it runs at the start of every API
// request, so a due check-in exists by the time anyone looks — same persisted schedule, same rule.
import { randomBytes } from "node:crypto";
import type { Store } from "./store.js";
import { checkinConfig } from "./config.js";
import { computeNextDue, type Cadence } from "./time.js";
import { log } from "./log.js";

export const OPEN_STATUSES = ["ready", "in_progress", "clarifying", "offered", "acting"] as const;
const OPEN_SQL = `('ready','in_progress','clarifying','offered','acting')`;

export interface ScheduleRow {
  cadence: Cadence; time_local: string; timezone: string;
  enabled: number; next_due_at: number | null; updated_at: number;
}
export interface CheckinRow {
  id: string; source: "scheduled" | "manual"; status: string;
  created_at: number; due_at: number; expires_at: number;
  started_at: number | null; closed_at: number | null; token_hash: string | null;
  outcome: string | null; skill_id: string | null; classifier_source: string | null;
  executor: string | null; action_started_at: number | null; action_ends_at: number | null; action_result: string | null;
}

export const getSchedule = (db: Store) =>
  db.get<ScheduleRow>(`SELECT cadence, time_local, timezone, enabled, next_due_at, updated_at FROM schedule WHERE id = 1`);

export const getOpenCheckin = (db: Store) =>
  db.get<CheckinRow>(`SELECT * FROM checkins WHERE status IN ${OPEN_SQL} ORDER BY created_at DESC LIMIT 1`);

export async function saveSchedule(
  db: Store,
  input: { cadence: Cadence; time_local: string; timezone: string; enabled: boolean; first_due_in_seconds?: number },
  now: number,
) {
  const next = !input.enabled ? null
    : input.first_due_in_seconds ? now + input.first_due_in_seconds * 1000
    : computeNextDue(input.cadence, input.time_local, input.timezone, now);
  await db.run(`
    INSERT INTO schedule (id, cadence, time_local, timezone, enabled, next_due_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET cadence = excluded.cadence, time_local = excluded.time_local,
      timezone = excluded.timezone, enabled = excluded.enabled,
      next_due_at = excluded.next_due_at, updated_at = excluded.updated_at
  `, [input.cadence, input.time_local, input.timezone, input.enabled ? 1 : 0, next, now]);
  log("schedule.saved", { cadence: input.cadence, enabled: input.enabled, next_due_at: next ?? "none" });
  return (await getSchedule(db))!;
}

/** Closes check-ins whose window has passed. */
export async function expireStale(db: Store, now: number) {
  const timeout = checkinConfig.in_progress_timeout_minutes * 60_000;
  const expired = await db.run(`UPDATE checkins SET status = 'expired', closed_at = ?, token_hash = NULL, outcome = 'none'
    WHERE status = 'ready' AND expires_at <= ?`, [now, now]);
  const abandoned = await db.run(`UPDATE checkins SET status = 'abandoned', closed_at = ?, token_hash = NULL,
      outcome = COALESCE(outcome, 'none')
    WHERE status IN ('in_progress','clarifying','offered') AND started_at <= ?`, [now, now - timeout]);
  // A running action that was never closed: it ran, so the check-in completes (grace: 10 min after it ended).
  const actions = await db.run(`UPDATE checkins SET status = 'completed', closed_at = ?, token_hash = NULL, action_result = 'timed_out'
    WHERE status = 'acting' AND COALESCE(action_ends_at, action_started_at) <= ?`, [now, now - 10 * 60_000]);
  if (expired.changes || abandoned.changes || actions.changes) {
    log("checkins.expired", { expired: expired.changes, abandoned: abandoned.changes, actions: actions.changes });
  }
}

/**
 * Creates a due check-in in `ready` state. If one is already open, returns it instead, so there is
 * never more than one open check-in (single conditional INSERT — atomic on both backends).
 */
export async function createDueCheckin(db: Store, source: "scheduled" | "manual", now: number): Promise<{ checkin: CheckinRow; created: boolean }> {
  await expireStale(db, now);
  const id = randomBytes(9).toString("base64url");
  const expires = now + checkinConfig.ready_window_minutes * 60_000;
  const r = await db.run(`INSERT INTO checkins (id, source, status, created_at, due_at, expires_at)
    SELECT ?, ?, 'ready', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM checkins WHERE status IN ${OPEN_SQL})`,
    [id, source, now, now, expires]);
  const open = (await getOpenCheckin(db))!;
  if (r.changes) log("checkin.ready", { id, source });
  return { checkin: open, created: r.changes > 0 };
}

/** One scheduler pass. Safe to call at any frequency. */
export async function tick(db: Store, now: number) {
  await expireStale(db, now);
  const s = await getSchedule(db);
  if (!s || !s.enabled || s.next_due_at == null || now < s.next_due_at) return { fired: false };
  // Advance first (conditionally) so concurrent ticks can't fire the same slot twice.
  const next = computeNextDue(s.cadence, s.time_local, s.timezone, now);
  const claimed = await db.run(`UPDATE schedule SET next_due_at = ? WHERE id = 1 AND next_due_at = ?`, [next, s.next_due_at]);
  if (!claimed.changes) return { fired: false };
  // Missed slots (e.g. laptop asleep) collapse into this one check-in.
  const result = await createDueCheckin(db, "scheduled", now);
  log("scheduler.fired", { created: result.created, next_due_at: next });
  return { fired: true, created: result.created };
}

export function startScheduler(db: Store, tickMs: number, clock: () => number = Date.now) {
  const run = () => tick(db, clock()).catch((e) => log("scheduler.error", { name: (e as Error).name }));
  run();
  const handle = setInterval(run, tickMs);
  handle.unref();
  return () => clearInterval(handle);
}
