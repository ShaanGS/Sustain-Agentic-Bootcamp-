// HTTP API. No request logging middleware; bodies are never logged or echoed.
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.js";
import { checkinConfig, crisisPhrases, crisisPhraseCount, helplines, needs, skills, skillsReview, skillById } from "./config.js";
import { createDueCheckin, getOpenCheckin, getSchedule, saveSchedule, expireStale, tick, OPEN_STATUSES } from "./scheduler.js";
import { startCheckin, respond, clarify, actCheckin, closeCheckin, skipCheckin, resumeCheckin, endCheckin, HttpError } from "./checkins.js";
import type { Classifier } from "./pipeline/classify/types.js";
import { recentRuns } from "./demoLog.js";
import { isValidTimeZone } from "./time.js";
import { log } from "./log.js";

export interface AppDeps {
  db: Store; classifier: Classifier; clock?: () => number; tickMs?: number;
  /** Serverless: run one scheduler pass at the start of each API request (no long-lived timer). */
  tickOnRequest?: boolean;
}

const publicCheckin = (c: { id: string; status: string; source: string; due_at: number; expires_at: number; started_at: number | null }) => ({
  id: c.id, status: c.status, source: c.source, due_at: c.due_at, expires_at: c.expires_at, started_at: c.started_at,
  // When an unfinished check-in will be closed automatically (see scheduler.expireStale).
  closes_at: c.started_at ? c.started_at + checkinConfig.in_progress_timeout_minutes * 60_000 : c.expires_at,
});

export function createApp({ db, classifier, clock = Date.now, tickMs = 15000, tickOnRequest = false }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));
  const route = (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  // Serverless scheduler: one pass before every API request, so a due check-in exists by the time anyone looks.
  if (tickOnRequest) app.use("/api", (_req, _res, next) => { tick(db, clock()).then(() => next(), next); });

  app.get("/api/state", route(async (_req, res) => {
    const now = clock();
    await expireStale(db, now);
    const schedule = await getSchedule(db);
    const open = await getOpenCheckin(db);
    const last = await db.get<{ status: string; outcome: string | null; skill_id: string | null; closed_at: number | null; executor: string | null; action_result: string | null }>(
      `SELECT status, outcome, skill_id, closed_at, executor, action_result FROM checkins
      WHERE status NOT IN ('ready','in_progress','clarifying','offered','acting') ORDER BY COALESCE(closed_at, created_at) DESC, created_at DESC LIMIT 1`);
    res.json({
      now,
      schedule: schedule ? {
        cadence: schedule.cadence, time_local: schedule.time_local, timezone: schedule.timezone,
        enabled: !!schedule.enabled, next_due_at: schedule.next_due_at,
      } : null,
      scheduler: tickOnRequest
        ? { runs_on: "server, on each request (serverless)", tick_seconds: 0, notifications: "none — shown in the app when due" }
        : { runs_on: "server", tick_seconds: Math.round(tickMs / 1000), notifications: "none — shown in the app when due" },
      open_checkin: open ? publicCheckin(open) : null,
      last_checkin: last ? {
        status: last.status, outcome: last.outcome, closed_at: last.closed_at,
        // Skill titles are shown only for ordinary outcomes; help outcomes carry nothing extra.
        skill_title: last.outcome === "help" ? null : (last.skill_id ? skillById(last.skill_id)?.title ?? null : null),
        action_label: last.outcome === "help" || !last.skill_id ? null : skillById(last.skill_id)?.executor.label ?? null,
        action_result: last.outcome === "help" ? null : last.action_result,
      } : null,
      classifier: classifier.info,
      storage: db.kind,
      helplines,
    });
  }));

  app.put("/api/schedule", route(async (req, res) => {
    const b = req.body ?? {};
    const cadence = b.cadence;
    const time_local = b.time_local;
    const timezone = b.timezone;
    if (cadence !== "daily" && cadence !== "weekdays") throw new HttpError(400, "invalid_cadence");
    if (typeof time_local !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time_local)) throw new HttpError(400, "invalid_time");
    if (typeof timezone !== "string" || !isValidTimeZone(timezone)) throw new HttpError(400, "invalid_timezone");
    const first = b.first_due_in_seconds;
    if (first !== undefined && (!Number.isInteger(first) || first < 10 || first > 3600)) throw new HttpError(400, "invalid_first_due");
    const s = await saveSchedule(db, { cadence, time_local, timezone, enabled: b.enabled !== false, first_due_in_seconds: first }, clock());
    res.json({ cadence: s.cadence, time_local: s.time_local, timezone: s.timezone, enabled: !!s.enabled, next_due_at: s.next_due_at });
  }));

  // "Check in now" — the same creation path the scheduler uses.
  app.post("/api/checkins/now", route(async (_req, res) => {
    const { checkin, created } = await createDueCheckin(db, "manual", clock());
    res.status(created ? 201 : 200).json({ checkin: publicCheckin(checkin), created });
  }));

  const id = (req: Request) => String(req.params.id);
  app.post("/api/checkins/:id/start", route(async (req, res) => { res.json(await startCheckin(db, id(req), clock())); }));
  app.post("/api/checkins/:id/respond", route(async (req, res) => {
    res.json(await respond(db, classifier, id(req), req.body?.token, req.body?.text, clock));
  }));
  app.post("/api/checkins/:id/clarify", route(async (req, res) => {
    res.json(await clarify(db, classifier, id(req), req.body?.token, req.body?.choice, req.body?.hold, clock));
  }));
  app.post("/api/checkins/:id/act", route(async (req, res) => { res.json(await actCheckin(db, id(req), req.body?.token, clock())); }));
  app.post("/api/checkins/:id/close", route(async (req, res) => {
    res.json(await closeCheckin(db, id(req), req.body?.token, clock(), req.body?.action_result));
  }));
  app.post("/api/checkins/:id/skip", route(async (req, res) => { res.json(await skipCheckin(db, id(req), clock())); }));
  app.post("/api/checkins/:id/resume", route(async (req, res) => { res.json(await resumeCheckin(db, id(req), clock())); }));
  app.post("/api/checkins/:id/end", route(async (req, res) => { res.json(await endCheckin(db, id(req), clock())); }));

  app.get("/api/protocol", route(async (_req, res) => {
    const runs = await recentRuns(db);
    res.json({
      pipeline: [
        { step: "trigger", text: "A check-in is created by the server scheduler at the student's chosen time (or by “Check in now”, the same path)." },
        { step: "observe", text: "One short response. The session token must be valid. The text is held in memory only — never stored or logged." },
        { step: "safety", text: `Explicit backstop first: ${crisisPhraseCount} reviewed self-harm and emergency phrases, local, no network. A hit ends the ordinary flow before any model call.` },
        { step: "model", text: "Otherwise one model call assesses risk first (SAFE / HIGH_RISK / UNCERTAIN), then one need and short context. Timeout, error or invalid output becomes UNCERTAIN — never SAFE." },
        { step: "understand", text: "The need comes from a fixed list. Context (e.g. “three assignments due Friday”) is display-only, length-limited and never stored." },
        { step: "decide", text: "A server table decides: HIGH_RISK → human help; SAFE → the one skill mapped to that need; UNCERTAIN → one tap-to-choose question, after which the original response is re-checked." },
        { step: "act", text: "The skill runs one allowlisted executor — focus timer, guided breathing, guided reset, copy a message, or acknowledge. Duration and limits are server-controlled. No network, messaging, files or other tools." },
        { step: "end", text: "The check-in closes. Still does not continue the conversation." },
      ],
      executors: skills.map((s) => ({ skill_id: s.id, type: s.executor.type, label: s.executor.label, duration_s: s.executor.duration_s ?? null })),
      prompt: checkinConfig.prompt,
      needs: needs.map((n) => ({ id: n.id, label: n.label, skill_id: n.skill_id })),
      skills: skills.map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
      skills_review: skillsReview,
      crisis_phrases: { count: crisisPhraseCount, self_harm: crisisPhrases.categories.self_harm.length, emergency: crisisPhrases.categories.emergency.length, reviewed_on: crisisPhrases.reviewed_on },
      helplines,
      classifier: classifier.info,
      storage: [
        { where: db.kind === "postgres" ? "Postgres (Neon)" : "SQLite", what: "Schedule; per check-in: id, source, status, timestamps, outcome, skill id, executor, action start/end and result, classifier source.", text_stored: false },
        { where: "Sealed hold (clarification only)", what: "If one clarification is needed, the response is encrypted (AES-256-GCM, bound to this check-in, 15 min expiry) and kept in page memory only, so its safety can be re-checked once. Never written to any database, log or browser storage.", text_stored: false },
        { where: "Server logs", what: "Event codes and ids only. No request bodies.", text_stored: false },
        { where: "Browser", what: "Only the opaque session token, in sessionStorage. Response text lives in page memory until submitted, then cleared.", text_stored: false },
        { where: "Agent trace", what: "Last 20 check-ins as pipeline step codes and reviewed labels, no text. Pruned on write.", text_stored: false },
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
        "Context Still extracts (e.g. “three assignments due Friday”) is shown back to you once and never stored.",
        "Still does not contact anyone on your behalf.",
      ],
      open_statuses: OPEN_STATUSES,
      recent_runs: runs,
    });
  }));

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
