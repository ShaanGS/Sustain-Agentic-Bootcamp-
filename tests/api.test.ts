import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../server/db.js";
import { createApp } from "../server/app.js";
import { localClassifier } from "../server/pipeline/classify/local.js";
import type { Classifier } from "../server/pipeline/classify/types.js";
import { setLogSink } from "../server/log.js";
import { clearRuns, recentRuns } from "../server/demoLog.js";
import { heldCount, holdForClarify, clearHeld } from "../server/ephemeral.js";
import { EMPTY_CONTEXT } from "../server/pipeline/classify/schema.js";

let now = Date.parse("2026-09-29T04:30:00Z");
const clock = () => now;

function setup(classifier: Classifier = localClassifier(), dbPath = ":memory:") {
  const db = openDb(dbPath);
  return { db, app: createApp({ db, classifier, clock }) };
}

async function begin(app: ReturnType<typeof setup>["app"]) {
  const c = await request(app).post("/api/checkins/now").expect(201);
  const s = await request(app).post(`/api/checkins/${c.body.checkin.id}/start`).expect(200);
  return { id: c.body.checkin.id as string, token: s.body.token as string };
}

beforeEach(() => { now = Date.parse("2026-09-29T04:30:00Z"); clearRuns(); clearHeld(); setLogSink(() => {}); });


const fake = (fn: Classifier["classify"], provider: "groq" | "local" = "groq"): Classifier & { classify: ReturnType<typeof vi.fn> } =>
  ({ info: { ...localClassifier().info, provider }, classify: vi.fn(fn) }) as any;
const say = (app: any, t: { id: string; token: string }, text: string) =>
  request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text });

describe("DEMO 1 — safe, understood, one real action", () => {
  it("three assignments → SAFE → COMPETING_TASKS → PRIORITIZE → focus timer runs → closes", async () => {
    const { app, db } = setup();
    const t = await begin(app);
    const r = await say(app, t, "I have three assignments due this week and keep jumping between all of them.").expect(200);
    expect(r.body.route).toBe("skill");
    expect(r.body.need_id).toBe("COMPETING_TASKS");
    expect(r.body.understood).toBe("several tasks competing");
    expect(r.body.context.situation).toBe("three assignments due this week");
    expect(r.body.skill.id).toBe("PRIORITIZE");
    expect(r.body.action).toMatchObject({ executor: "FOCUS_TIMER", duration_s: 900, target: "the task due soonest" });
    expect(r.body.trace.map((s: any) => s.step)).toEqual(["trigger", "observe", "safety", "model", "understand", "decide", "act"]);
    expect(r.body.trace.find((s: any) => s.step === "safety").label).toBe("Clear");
    expect(r.body.trace.find((s: any) => s.step === "act").status).toBe("pending");

    // ACT — the executor actually starts, server-side, and is idempotent.
    const a1 = await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    expect(a1.body).toMatchObject({ status: "acting", executor: "FOCUS_TIMER", already_running: false });
    expect(a1.body.ends_at - a1.body.started_at).toBe(900_000);
    now += 5000;
    const a2 = await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    expect(a2.body).toMatchObject({ already_running: true, started_at: a1.body.started_at });
    const row = db.prepare("SELECT status, executor, action_started_at FROM checkins WHERE id = ?").get(t.id) as any;
    expect(row).toMatchObject({ status: "acting", executor: "FOCUS_TIMER", action_started_at: a1.body.started_at });

    // END
    const c = await request(app).post(`/api/checkins/${t.id}/close`).send({ token: t.token, action_result: "completed" }).expect(200);
    expect(c.body).toEqual({ status: "completed", action_result: "completed" });
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(409); // never twice
    const st = await request(app).get("/api/state");
    expect(st.body.open_checkin).toBeNull();
    expect(st.body.last_checkin).toMatchObject({ status: "completed", skill_title: "Prioritize", action_label: "15-minute focus", action_result: "completed" });

    // Agent trace in the protocol view: TRIGGER → … → ACT started → END closed.
    const run = recentRuns()[0];
    expect(run.steps.map((s) => s.step)).toEqual(["trigger", "observe", "safety", "model", "understand", "decide", "act", "end"]);
    expect(run.steps.find((s) => s.step === "act")!.label).toMatch(/FOCUS_TIMER · completed/);
  });
});

describe("DEMO 2 — a different safe path, a different executor", () => {
  it("presentation nerves → ACUTE_TENSION → PACED_BREATHING → 60-second guide", async () => {
    const { app } = setup();
    const t = await begin(app);
    const r = await say(app, t, "I'm wound up about tomorrow's presentation and can't settle.").expect(200);
    expect(r.body).toMatchObject({ route: "skill", need_id: "ACUTE_TENSION", skill: { id: "PACED_BREATHING" } });
    expect(r.body.context.situation).toBe("tomorrow's presentation");
    expect(r.body.action).toMatchObject({ executor: "BREATHING_GUIDE", duration_s: 60, rounds: 6 });
    const a = await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    expect(a.body.ends_at - a.body.started_at).toBe(60_000);
  });
  it("viva avoidance → DIFFICULTY_STARTING → START_SMALL → 10-minute focus on the viva", async () => {
    const { app } = setup();
    const t = await begin(app);
    const r = await say(app, t, "I have my viva tomorrow morning and I haven't started preparing. I keep opening Instagram instead.").expect(200);
    expect(r.body).toMatchObject({ need_id: "DIFFICULTY_STARTING", skill: { id: "START_SMALL" }, action: { executor: "FOCUS_TIMER", duration_s: 600, target: "your viva prep" } });
  });
  it("copy-message executor records a copy, never a send", async () => {
    const { app } = setup();
    const t = await begin(app);
    const r = await say(app, t, "Everyone went home for the weekend and I feel lonely.").expect(200);
    expect(r.body.action).toMatchObject({ executor: "COPY_MESSAGE", message: expect.any(String) });
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    const c = await request(app).post(`/api/checkins/${t.id}/close`).send({ token: t.token, action_result: "sent" }).expect(200);
    expect(c.body.action_result).toBe("copied"); // "sent" is not an allowed result for this executor
  });
});

describe("DEMO 3 — explicit crisis phrase", () => {
  it("backstop matches → model never called → human help → terminal, no skill ever executes", async () => {
    const model = fake(async () => { throw new Error("must not be called"); });
    const { app } = setup(model);
    const t = await begin(app);
    const r = await say(app, t, "I don't want to be here anymore. I want to end my life.").expect(200);
    expect(model.classify).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ route: "help", reason: "explicit_phrase", kind: "support" });
    expect(r.body.skill).toBeUndefined();
    expect(r.body.action).toBeUndefined();
    expect(r.body.helplines.primary.numbers[0].tel).toBe("14416");
    expect(r.body.helplines.emergency.numbers[0].tel).toBe("112");
    expect(r.body.trace.find((s: any) => s.step === "model")).toMatchObject({ status: "skipped", label: "Not called" });
    expect(r.body.trace.find((s: any) => s.step === "decide").label).toBe("HUMAN_HELP");
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(409);
    await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "ACUTE_TENSION" }).expect(409);
    await say(app, t, "hello").expect(409);
  });
});

describe("DEMO 4 — dangerous statements never reach a skill", () => {
  it.each([
    "I ate poison with food.",
    "I took too many pills.",
    "I overdosed.",
    "I hurt myself and I'm not safe.",
    "I might hurt myself tonight.",
  ])("%j → explicit emergency/self-harm backstop → help, model not called", async (line) => {
    const model = fake(async () => ({ source: "groq", ms: 1, ok: true, risk: "SAFE", need_id: "ACUTE_TENSION", context: EMPTY_CONTEXT }));
    const { app } = setup(model);
    const t = await begin(app);
    const r = await say(app, t, line).expect(200);
    expect(r.body.route).toBe("help");
    expect(model.classify).not.toHaveBeenCalled();
  });
  it("poisoning leads with emergency (112)", async () => {
    const { app } = setup();
    const t = await begin(app);
    expect((await say(app, t, "I ate poison with food.")).body).toMatchObject({ route: "help", kind: "emergency" });
  });
  it.each([
    "I swallowed something poisonous.",
    "I swallowed a whole strip of my mom's sleeping tablets.",
  ])("%j (not an explicit phrase) → local safety layer HIGH_RISK → help", async (line) => {
    const { app } = setup();
    const t = await begin(app);
    const r = await say(app, t, line).expect(200);
    expect(r.body.route).toBe("help");
    expect(r.body.trace.find((s: any) => s.step === "safety").label).toBe("HIGH_RISK · model");
  });
  it("model HIGH_RISK on unlisted phrasing → help, no clarification", async () => {
    const model = fake(async () => ({ source: "groq", ms: 1, ok: true, risk: "HIGH_RISK", need_id: null, context: EMPTY_CONTEXT }));
    const { app } = setup(model);
    const t = await begin(app);
    const r = await say(app, t, "I don't trust myself around my meds tonight").expect(200);
    expect(r.body).toMatchObject({ route: "help", reason: "model_high_risk" });
  });
});

describe("DEMO 5 — model failure never invents a safe action", () => {
  it.each([
    [{ ok: false, reason: "timeout" }],
    [{ ok: false, reason: "bad_json" }],
    [{ ok: false, reason: "need_not_allowed" }],
    [{ ok: false, reason: "schema_mismatch" }],
  ])("%j → UNCERTAIN → one clarification, no skill", async (res) => {
    const model = fake(async () => ({ source: "groq", ms: 6000, ...res }) as any);
    const { app } = setup(model);
    const t = await begin(app);
    const r = await say(app, t, "I have three assignments due").expect(200);
    expect(r.body).toMatchObject({ route: "clarify", reason: "classifier_failed" });
    expect(r.body.skill).toBeUndefined();
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(409);
  });
  it("after the one clarification the original is re-checked, then one approved skill", async () => {
    const model = fake(async () => ({ source: "groq", ms: 1, ok: false, reason: "timeout" }) as any);
    const { app } = setup(model);
    const t = await begin(app);
    await say(app, t, "I have three assignments due").expect(200);
    expect(heldCount()).toBe(1);
    await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "free text is not allowed" }).expect(400);
    const c = await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "DIFFICULTY_STARTING" }).expect(200);
    expect(c.body).toMatchObject({ route: "skill", skill: { id: "START_SMALL" }, action: { executor: "FOCUS_TIMER" } });
    expect(model.classify).toHaveBeenCalledTimes(2); // respond + safety re-check
    expect(heldCount()).toBe(0); // the held response is dropped once used
  });
});

describe("DEMO 6 — a clarification can never downgrade a high-risk response", () => {
  it("poisoning held for clarification + benign choice → still HUMAN HELP (explicit re-check)", async () => {
    const model = fake(async () => ({ source: "groq", ms: 1, ok: true, risk: "UNCERTAIN", need_id: null, context: EMPTY_CONTEXT }));
    const { app, db } = setup(model);
    const t = await begin(app);
    // Force the "somehow UNCERTAIN" case: an ambiguous line reaches clarification…
    await say(app, t, "idk").expect(200);
    // …and the response held for it is the dangerous one (simulates a missed first classification).
    holdForClarify(t.id, { text: "I ate poison with food.", risk: "UNCERTAIN", context: EMPTY_CONTEXT }, now);
    const c = await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "ACUTE_TENSION" }).expect(200);
    expect(c.body).toMatchObject({ route: "help", reason: "recheck_high_risk", kind: "emergency" });
    expect(c.body.skill).toBeUndefined();
    const row = db.prepare("SELECT status, skill_id, executor FROM checkins WHERE id = ?").get(t.id) as any;
    expect(row).toMatchObject({ status: "help_shown", skill_id: null, executor: null });
  });
  it("model says UNCERTAIN first, HIGH_RISK on the re-check → HUMAN HELP despite a benign choice", async () => {
    let calls = 0;
    const model = fake(async () => ({ source: "groq", ms: 1, ok: true, risk: ++calls === 1 ? "UNCERTAIN" : "HIGH_RISK", need_id: null, context: EMPTY_CONTEXT }) as any);
    const { app } = setup(model);
    const t = await begin(app);
    await say(app, t, "something happened with the stuff I took").expect(200);
    const c = await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "ACUTE_TENSION" }).expect(200);
    expect(c.body.route).toBe("help");
  });
  it("if the held response is gone (e.g. restart), no skill is offered", async () => {
    const model = fake(async () => ({ source: "groq", ms: 1, ok: true, risk: "UNCERTAIN", need_id: null, context: EMPTY_CONTEXT }));
    const { app } = setup(model);
    const t = await begin(app);
    await say(app, t, "idk").expect(200);
    now += 16 * 60_000 - 1; // held entry expires first (TTL) — then the check-in itself
    const c = await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "ACUTE_TENSION" });
    expect(c.body.route).not.toBe("skill");
  });
  it("'I'd rather talk to a person' → help", async () => {
    const { app } = setup();
    const t = await begin(app);
    expect((await say(app, t, "idk")).body.route).toBe("clarify");
    const c = await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "talk_to_person" }).expect(200);
    expect(c.body).toMatchObject({ route: "help", reason: "student_asked_for_person" });
  });
});

describe("state machine", () => {
  it("one free-text response per check-in; bad sessions and oversize input rejected", async () => {
    const { app } = setup();
    const t = await begin(app);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: "nope", text: "hi" }).expect(401);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: "x".repeat(501) }).expect(400);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: "   " }).expect(400);
    await say(app, t, "I have three assignments due this week").expect(200);
    await say(app, t, "more").expect(409);
    await request(app).post(`/api/checkins/nope/start`).expect(404);
  });
  it("closing without running the action records not_started", async () => {
    const { app } = setup();
    const t = await begin(app);
    await say(app, t, "I have three assignments due this week").expect(200);
    const c = await request(app).post(`/api/checkins/${t.id}/close`).send({ token: t.token }).expect(200);
    expect(c.body.action_result).toBe("not_started");
  });
  it("in-progress check-ins are abandoned after 15 minutes", async () => {
    const { app } = setup();
    const t = await begin(app);
    now += 16 * 60_000;
    await say(app, t, "I have three assignments").expect(409);
  });
  it("a running action is completed by expiry if never closed", async () => {
    const { app, db } = setup();
    const t = await begin(app);
    await say(app, t, "I'm wound up about tomorrow's presentation and can't settle.").expect(200);
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    now += 60_000 + 11 * 60_000;
    await request(app).get("/api/state").expect(200);
    expect(db.prepare("SELECT status, action_result FROM checkins WHERE id = ?").get(t.id)).toMatchObject({ status: "completed", action_result: "timed_out" });
  });
  it("schedule endpoint validates input and the state reflects it", async () => {
    const { app } = setup();
    await request(app).put("/api/schedule").send({ cadence: "hourly", time_local: "18:30", timezone: "Asia/Kolkata" }).expect(400);
    await request(app).put("/api/schedule").send({ cadence: "daily", time_local: "25:00", timezone: "Asia/Kolkata" }).expect(400);
    await request(app).put("/api/schedule").send({ cadence: "daily", time_local: "18:30", timezone: "Mars/Base" }).expect(400);
    const s = await request(app).put("/api/schedule").send({ cadence: "daily", time_local: "18:30", timezone: "Asia/Kolkata" }).expect(200);
    expect(new Date(s.body.next_due_at).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });
});

describe("another tab", () => {
  it("can take over an unanswered check-in; the old token stops working", async () => {
    const { app } = setup();
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/resume`).expect(200);
    expect(r.body.token).not.toBe(token);
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "I have three assignments" }).expect(401);
    const ok = await request(app).post(`/api/checkins/${id}/respond`).send({ token: r.body.token, text: "I have three assignments due" }).expect(200);
    expect(ok.body.route).toBe("skill");
    await request(app).post(`/api/checkins/${id}/resume`).expect(409);
  });
  it("can end an open check-in: unanswered -> abandoned, answered -> completed", async () => {
    const { app } = setup();
    let t = await begin(app);
    expect((await request(app).post(`/api/checkins/${t.id}/end`).expect(200)).body.status).toBe("abandoned");
    t = await begin(app);
    await say(app, t, "I have three assignments due").expect(200);
    expect((await request(app).post(`/api/checkins/${t.id}/end`).expect(200)).body.status).toBe("completed");
    expect((await request(app).get("/api/state")).body.open_checkin).toBeNull();
  });
});

describe("protocol disclosure", () => {
  it("always discloses the Groq path, whatever classifier is active", async () => {
    const { app } = setup();
    const p = await request(app).get("/api/protocol").expect(200);
    expect(p.body.disclosures).toContain("When Groq is active, your response is sent to Groq for classification.");
    expect(p.body.disclosures.join(" ")).not.toMatch(/nothing you wrote/i);
  });
});

describe("privacy", () => {
  it("submitted text never reaches the database file, logs, state, or demo log", async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    const dir = mkdtempSync(join(tmpdir(), "still-"));
    const dbPath = join(dir, "still.db");
    const { app, db } = setup(localClassifier(), dbPath);
    const SENTINEL_A = "ZEBRA-7731 three assignments due this week";
    const SENTINEL_B = "QUOKKA-4412 I want to end my life";
    let t = await begin(app);
    const ra = await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: SENTINEL_A }).expect(200);
    expect(ra.body.context.situation).toBe("three assignments due this week"); // shown once to the student…
    await request(app).post(`/api/checkins/${t.id}/act`).send({ token: t.token }).expect(200);
    await request(app).post(`/api/checkins/${t.id}/close`).send({ token: t.token, action_result: "completed" }).expect(200);
    // …and a clarification path (the response is held in memory only, then dropped).
    t = await begin(app);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: "PANGOLIN-9 idk" }).expect(200);
    await request(app).post(`/api/checkins/${t.id}/clarify`).send({ token: t.token, choice: "DOING_OK" }).expect(200);
    expect(heldCount()).toBe(0);
    await request(app).post(`/api/checkins/${t.id}/close`).send({ token: t.token }).expect(200);
    t = await begin(app);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: SENTINEL_B }).expect(200);
    // Malformed JSON containing the sentinel must not be logged either.
    await request(app).post(`/api/checkins/${t.id}/respond`).set("content-type", "application/json")
      .send(`{"token": "x", "text": "ZEBRA-7731 broken`).expect(400);

    const state = JSON.stringify((await request(app).get("/api/state")).body);
    const protocol = JSON.stringify((await request(app).get("/api/protocol")).body);
    (db as Db).close();
    const files = [dbPath, dbPath + "-wal", dbPath + "-shm"].filter(existsSync).map((f) => readFileSync(f).toString("latin1"));
    for (const hay of [...files, lines.join("\n"), state, protocol]) {
      expect(hay).not.toContain("ZEBRA-7731");
      expect(hay).not.toContain("QUOKKA-4412");
      expect(hay).not.toContain("end my life");
      expect(hay).not.toContain("PANGOLIN-9");
      expect(hay).not.toContain("three assignments due this week"); // extracted context is never stored either
    }
    expect(lines.length).toBeGreaterThan(0);
  });
});
