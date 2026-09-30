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
import { clearRuns } from "../server/demoLog.js";

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

beforeEach(() => { now = Date.parse("2026-09-29T04:30:00Z"); clearRuns(); setLogSink(() => {}); });

describe("check-in journey", () => {
  it("ordinary path: ready → start → respond → one skill → close", async () => {
    const { app } = setup();
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/respond`)
      .send({ token, text: "I have three assignments due this week and keep jumping between all of them." }).expect(200);
    expect(r.body.route).toBe("skill");
    expect(r.body.matched_label).toBe("too many things competing");
    expect(r.body.selected_action).toBe("Prioritize");
    expect(r.body.skill.id).toBe("PRIORITIZE");
    expect(r.body.trace.map((s: any) => s.step)).toEqual(["session", "crisis_phrase", "classifier", "validate", "policy"]);
    // Every step that ran carries a real measured duration; total covers the request.
    for (const step of r.body.trace) expect(typeof step.ms).toBe("number");
    expect(r.body.total_ms).toBeGreaterThanOrEqual(r.body.trace.reduce((a: number, s: any) => a + s.ms, 0) * 0.5);
    // Only one free-text response per check-in.
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "more" }).expect(409);
    await request(app).post(`/api/checkins/${id}/close`).send({ token }).expect(200);
    const st = await request(app).get("/api/state").expect(200);
    expect(st.body.open_checkin).toBeNull();
    expect(st.body.last_checkin).toMatchObject({ status: "completed", outcome: "skill", skill_title: "Prioritize" });
    // Token is burned after close.
    await request(app).post(`/api/checkins/${id}/close`).send({ token }).expect(409);
  });

  it("crisis path: phrase stops the flow, classifier is never called, static helplines returned", async () => {
    const spy = vi.fn();
    const fake: Classifier = { info: localClassifier().info, classify: spy as any };
    const { app } = setup(fake);
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/respond`)
      .send({ token, text: "I don't want to be here anymore. I want to end my life." }).expect(200);
    expect(spy).not.toHaveBeenCalled();
    expect(r.body.route).toBe("help");
    expect(r.body.skill).toBeUndefined();
    expect(r.body.helplines.primary.numbers[0].tel).toBe("14416");
    expect(r.body.helplines.emergency.numbers[0].tel).toBe("112");
    const skipped = r.body.trace.find((s: any) => s.step === "classifier");
    expect(skipped.status).toBe("skipped");
    expect(skipped.ms).toBeUndefined(); // it did not run, so no time is reported
    expect(r.body.trace.find((s: any) => s.step === "validate")).toBeUndefined();
    // Check-in is closed; nothing further is possible.
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "hello" }).expect(409);
    const st = await request(app).get("/api/state");
    expect(st.body.last_checkin).toMatchObject({ status: "help_shown", outcome: "help", skill_title: null });
  });

  it("classifier CRISIS label also routes to help", async () => {
    const fake: Classifier = { info: localClassifier().info, classify: async () => ({ source: "local", ms: 1, ok: true, classification: "CRISIS", need_id: null }) };
    const { app } = setup(fake);
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "everything feels pointless lately" });
    expect(r.body.route).toBe("help");
  });

  it("provider failure never becomes ORDINARY: clarification, then one tap to a skill", async () => {
    const down: Classifier = { info: { ...localClassifier().info, provider: "groq" }, classify: async () => ({ source: "groq", ms: 6000, ok: false, reason: "timeout" }) };
    const { app } = setup(down);
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "I have three assignments due" }).expect(200);
    expect(r.body.route).toBe("clarify");
    expect(r.body.reason).toBe("classifier_failed");
    expect(r.body.options.length).toBeGreaterThan(3);
    await request(app).post(`/api/checkins/${id}/clarify`).send({ token, choice: "free text is not allowed" }).expect(400);
    const c = await request(app).post(`/api/checkins/${id}/clarify`).send({ token, choice: "cant_get_started" }).expect(200);
    expect(c.body.route).toBe("skill");
    expect(c.body.skill.id).toBe("TEN_MINUTE_START");
  });

  it("clarification offers a way to a person", async () => {
    const { app } = setup();
    const { id, token } = await begin(app);
    const r = await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "idk" });
    expect(r.body.route).toBe("clarify");
    const c = await request(app).post(`/api/checkins/${id}/clarify`).send({ token, choice: "talk_to_person" }).expect(200);
    expect(c.body.route).toBe("help");
  });

  it("rejects bad sessions and oversize input", async () => {
    const { app } = setup();
    const { id, token } = await begin(app);
    await request(app).post(`/api/checkins/${id}/respond`).send({ token: "nope", text: "hi" }).expect(401);
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "x".repeat(501) }).expect(400);
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "   " }).expect(400);
    await request(app).post(`/api/checkins/nope/start`).expect(404);
  });

  it("in-progress check-ins are abandoned after 15 minutes", async () => {
    const { app } = setup();
    const { id, token } = await begin(app);
    now += 16 * 60_000;
    await request(app).post(`/api/checkins/${id}/respond`).send({ token, text: "I have three assignments" }).expect(409);
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
    // Once answered it can no longer be taken over.
    await request(app).post(`/api/checkins/${id}/resume`).expect(409);
  });

  it("can end an open check-in: unanswered -> abandoned, answered -> completed", async () => {
    const { app } = setup();
    let t = await begin(app);
    expect((await request(app).post(`/api/checkins/${t.id}/end`).expect(200)).body.status).toBe("abandoned");
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: "hi" }).expect(409);
    t = await begin(app);
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: "I have three assignments due" }).expect(200);
    expect((await request(app).post(`/api/checkins/${t.id}/end`).expect(200)).body.status).toBe("completed");
    const st = await request(app).get("/api/state");
    expect(st.body.open_checkin).toBeNull();
    expect(st.body.last_checkin).toMatchObject({ status: "completed", outcome: "skill" });
    await request(app).post(`/api/checkins/${t.id}/end`).expect(409);
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
    await request(app).post(`/api/checkins/${t.id}/respond`).send({ token: t.token, text: SENTINEL_A }).expect(200);
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
    }
    expect(lines.length).toBeGreaterThan(0);
  });
});
