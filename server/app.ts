// HTTP API. No request logging middleware; bodies are never logged or echoed.
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";
import { checkinConfig, crisisPhrases, helplines, needs, skills, skillsReview, skillById } from "./config.js";
import { createDueCheckin, getOpenCheckin, getSchedule, saveSchedule, expireStale, OPEN_STATUSES } from "./scheduler.js";
import { startCheckin, respond, clarify, closeCheckin, skipCheckin, HttpError } from "./checkins.js";
import type { Classifier } from "./pipeline/classify/types.js";
import { recentRuns } from "./demoLog.js";
import { isValidTimeZone } from "./time.js";
import { log } from "./log.js";

export interface AppDeps { db: Db; classifier: Classifier; clock?: () => number; tickMs?: number }

const publicCheckin = (c: { id: string; status: string; source: string; due_at: number; expires_at: number; started_at: number | null }) => ({
  id: c.id, status: c.status, source: c.source, due_at: c.due_at, expires_at: c.expires_at, started_at: c.started_at,
  // When an unfinished check-in will be closed automatically (see scheduler.expireStale).
  closes_at: c.started_at ? c.started_at + checkinConfig.in_progress_timeout_minutes * 60_000 : c.expires_at,
});

export function createApp({ db, classifier, clock = Date.now, tickMs = 15000 }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));
  const wrap = (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

  app.get("/api/state", (_req, res) => {
    const now = clock();
    expireStale(db, now);
    const schedule = getSchedule(db);
    const open = getOpenCheckin(db);
    const last = db.prepare(`SELECT status, outcome, skill_id, closed_at FROM checkins
      WHERE status NOT IN ('ready','in_progress','clarifying','offered') ORDER BY COALESCE(closed_at, created_at) DESC LIMIT 1`)
      .get() as { status: string; outcome: string | null; skill_id: string | null; closed_at: number | null } | undefined;
    res.json({
      now,
      schedule: schedule ? {
        cadence: schedule.cadence, time_local: schedule.time_local, timezone: schedule.timezone,
        enabled: !!schedule.enabled, next_due_at: schedule.next_due_at,
      } : null,
      scheduler: { runs_on: "server", tick_seconds: Math.round(tickMs / 1000), notifications: "none — shown in the app when due" },
      open_checkin: open ? publicCheckin(open) : null,
      last_checkin: last ? {
        status: last.status, outcome: last.outcome, closed_at: last.closed_at,
        // Skill titles are shown only for ordinary outcomes; help outcomes carry nothing extra.
        skill_title: last.outcome === "help" ? null : (last.skill_id ? skillById(last.skill_id)?.title ?? null : null),
      } : null,
      classifier: classifier.info,
      helplines,
    });
  });

  app.put("/api/schedule", (req, res) => {
    const b = req.body ?? {};
    const cadence = b.cadence;
    const time_local = b.time_local;
    const timezone = b.timezone;
    if (cadence !== "daily" && cadence !== "weekdays") throw new HttpError(400, "invalid_cadence");
    if (typeof time_local !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time_local)) throw new HttpError(400, "invalid_time");
    if (typeof timezone !== "string" || !isValidTimeZone(timezone)) throw new HttpError(400, "invalid_timezone");
    const first = b.first_due_in_seconds;
    if (first !== undefined && (!Number.isInteger(first) || first < 10 || first > 3600)) throw new HttpError(400, "invalid_first_due");
    const s = saveSchedule(db, { cadence, time_local, timezone, enabled: b.enabled !== false, first_due_in_seconds: first }, clock());
    res.json({ cadence: s.cadence, time_local: s.time_local, timezone: s.timezone, enabled: !!s.enabled, next_due_at: s.next_due_at });
  });

  // "Check in now" — the same creation path the scheduler uses.
  app.post("/api/checkins/now", (_req, res) => {
    const { checkin, created } = createDueCheckin(db, "manual", clock());
    res.status(created ? 201 : 200).json({ checkin: publicCheckin(checkin), created });
  });

  app.post("/api/checkins/:id/start", (req, res) => { res.json(startCheckin(db, String(req.params.id), clock())); });
  app.post("/api/checkins/:id/respond", wrap(async (req, res) => {
    res.json(await respond(db, classifier, String(req.params.id), req.body?.token, req.body?.text, clock));
  }));
  app.post("/api/checkins/:id/clarify", (req, res) => {
    res.json(clarify(db, String(req.params.id), req.body?.token, req.body?.choice, clock()));
  });
  app.post("/api/checkins/:id/close", (req, res) => { res.json(closeCheckin(db, String(req.params.id), req.body?.token, clock())); });
  app.post("/api/checkins/:id/skip", (req, res) => { res.json(skipCheckin(db, String(req.params.id), clock())); });

  app.get("/api/protocol", (_req, res) => {
    res.json({
      pipeline: [
        { step: "session", text: "Check-in must be open and the single-use session token valid." },
        { step: "crisis_phrase", text: `Explicit crisis phrase check (${crisisPhrases.phrases.length} reviewed phrases, local, no network). A hit stops the ordinary flow before any model call.` },
        { step: "classifier", text: "Labels the response ORDINARY, UNCERTAIN or CRISIS and, if ORDINARY, one need id. It never writes advice." },
        { step: "validate", text: "Output must match the schema and the needs allowlist. Timeout, error or invalid output becomes UNCERTAIN — never ORDINARY." },
        { step: "policy", text: "Server table decides: CRISIS → human help; ORDINARY → the one skill mapped to that need; UNCERTAIN → one tap-to-choose clarification." },
        { step: "close", text: "The check-in ends. Still does not continue the conversation." },
      ],
      prompt: checkinConfig.prompt,
      needs: needs.map((n) => ({ id: n.id, label: n.label, skill_id: n.skill_id })),
      skills: skills.map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
      skills_review: skillsReview,
      crisis_phrases: { count: crisisPhrases.phrases.length, reviewed_on: crisisPhrases.reviewed_on },
      helplines,
      classifier: classifier.info,
      storage: [
        { where: "SQLite (data/still.db)", what: "Schedule; per check-in: id, source, status, timestamps, outcome, skill id, classifier source.", text_stored: false },
        { where: "Server logs", what: "Event codes and ids only. No request bodies.", text_stored: false },
        { where: "Browser", what: "Nothing written to localStorage/sessionStorage. Response text lives in page memory until submitted, then cleared.", text_stored: false },
        { where: "Demo log (memory)", what: "Last 20 pipeline step codes, no text. Cleared on server restart.", text_stored: false },
        {
          where: `Classifier: ${classifier.info.destination}`,
          what: classifier.info.sends_text_off_machine
            ? `Your response is sent to ${classifier.info.provider === "groq" ? "Groq" : classifier.info.provider} for classification. The provider's own data-retention policy applies. Still does not store it.`
            : "With the current classifier, your response does not leave this machine. Still does not store it.",
          text_stored: null,
        },
      ],
      disclosures: [
        "Your response isn't stored by Still: not in its database, not in browser storage, not in its logs.",
        "When Groq is active, your response is sent to Groq for classification.",
        "Still does not contact anyone on your behalf.",
      ],
      open_statuses: OPEN_STATUSES,
      recent_runs: recentRuns(),
    });
  });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not_found")));

  // Serve the built UI when present.
  const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  }

  // Error handler: never echoes or logs request bodies.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    const e = err as { type?: string; status?: number; name?: string };
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json" });
    if (e?.type === "entity.too.large") return res.status(413).json({ error: "too_large" });
    log("http.error", { name: e?.name ?? "unknown" });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
