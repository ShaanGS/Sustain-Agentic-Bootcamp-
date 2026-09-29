import { describe, it, expect, vi } from "vitest";
import { crisisPhraseHit } from "../server/pipeline/crisisPhrase.js";
import { validateClassifierOutput } from "../server/pipeline/classify/schema.js";
import { decide } from "../server/pipeline/policy.js";
import { localRules } from "../server/pipeline/classify/local.js";
import { groqClassifier } from "../server/pipeline/classify/groq.js";
import { ollamaClassifier } from "../server/pipeline/classify/ollama.js";
import type { ClassifyResult } from "../server/pipeline/classify/types.js";

describe("crisis phrase backstop", () => {
  it.each([
    "I don't want to be here anymore, I want to end my life.",
    "sometimes i think about suicide",
    "I keep wanting to HURT MYSELF",
    "I'm not going to kill myself but I think about it", // negation still routes to help
    "honestly i'd be better off dead",
    "i cant go on like this",
  ])("fires on %j", (t) => expect(crisisPhraseHit(t)).toBe(true));

  it.each([
    "I have three assignments due this week and keep jumping between all of them.",
    "this deadline is killing me",
    "I could kill for a coffee right now",
    "ran 5 kms today and I'm tired",
    "we're going to jump off the stage at the end of the play",
  ])("does not fire on %j", (t) => expect(crisisPhraseHit(t)).toBe(false));
});

describe("classifier output validation (fail closed)", () => {
  it("accepts ORDINARY with an allowlisted need", () => {
    expect(validateClassifierOutput({ classification: "ORDINARY", need_id: "too_many_tasks" }))
      .toEqual({ ok: true, classification: "ORDINARY", need_id: "too_many_tasks" });
  });
  it.each([
    [{ classification: "ORDINARY", need_id: "medication_advice" }, "need_not_allowed"],
    [{ classification: "ORDINARY" }, "ordinary_without_need"],
    [{ classification: "FINE", need_id: null }, "schema_mismatch"],
    [{ classification: "ORDINARY", need_id: "too_many_tasks", advice: "do X" }, "schema_mismatch"],
    ["ORDINARY", "schema_mismatch"],
    [null, "schema_mismatch"],
  ])("rejects %j", (raw, reason) => {
    expect(validateClassifierOutput(raw)).toEqual({ ok: false, reason });
  });
  it("drops need_id for CRISIS/UNCERTAIN", () => {
    expect(validateClassifierOutput({ classification: "CRISIS", need_id: "too_many_tasks" }))
      .toEqual({ ok: true, classification: "CRISIS", need_id: null });
  });
});

describe("policy", () => {
  const r = (x: object) => ({ source: "local", ms: 1, ...x }) as ClassifyResult;
  it("phrase hit always wins, even over an ORDINARY label", () => {
    expect(decide(true, r({ ok: true, classification: "ORDINARY", need_id: "too_many_tasks" })).action).toBe("help");
  });
  it("classifier CRISIS → help", () => {
    expect(decide(false, r({ ok: true, classification: "CRISIS", need_id: null }))).toEqual({ action: "help", reason: "classifier_crisis" });
  });
  it("classifier failure → clarify, never a skill", () => {
    const d = decide(false, r({ ok: false, reason: "timeout" }));
    expect(d.action).toBe("clarify");
    expect(d.action === "clarify" && d.reason).toBe("classifier_failed");
  });
  it("UNCERTAIN → clarify", () => {
    expect(decide(false, r({ ok: true, classification: "UNCERTAIN", need_id: null })).action).toBe("clarify");
  });
  it("ORDINARY → exactly the skill from the needs table", () => {
    const d = decide(false, r({ ok: true, classification: "ORDINARY", need_id: "wound_up" }));
    expect(d.action === "skill" && d.skill.id).toBe("PACED_BREATHING");
    expect(d.action === "skill" && d.matched_label).toBe("feeling wound up or tense");
  });
});

describe("local rules classifier", () => {
  it.each([
    ["I have three assignments due this week and keep jumping between all of them.", "too_many_tasks"],
    ["I'm really wound up about tomorrow's presentation and can't settle.", "wound_up"],
    ["I keep putting off my lab report, haven't started at all", "cant_get_started"],
    ["I've been up all night for days and I'm exhausted", "sleep_or_worn_out"],
    ["Everyone went home for the weekend and I feel lonely", "feeling_cut_off"],
    ["honestly I'm doing okay today", "doing_ok"],
  ])("%j → %s", (t, need) => expect(localRules(t)).toEqual({ classification: "ORDINARY", need_id: need }));

  it.each(["I feel hopeless about everything", "banana", "idk"])("%j → UNCERTAIN", (t) => {
    expect(localRules(t).classification).toBe("UNCERTAIN");
  });
});

describe("model providers fail closed", () => {
  const ok = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })));

  it("groq: valid ORDINARY passes", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"classification":"ORDINARY","need_id":"too_many_tasks"}') });
    expect(await c.classify("x")).toMatchObject({ ok: true, classification: "ORDINARY", need_id: "too_many_tasks", source: "groq" });
  });
  it("groq: missing key never calls the network", async () => {
    const f = vi.fn();
    const c = groqClassifier({ apiKey: "", model: "m", timeoutMs: 1000, fetchImpl: f as any });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "missing_api_key" });
    expect(f).not.toHaveBeenCalled();
  });
  it("groq: HTTP 500", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: vi.fn(async () => new Response("no", { status: 500 })) });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "http_500" });
  });
  it("groq: prose instead of JSON", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok("Sounds tough! Try breathing.") });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "bad_json" });
  });
  it("groq: off-list need", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"classification":"ORDINARY","need_id":"therapy"}') });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "need_not_allowed" });
  });
  it("groq: timeout", async () => {
    const slow = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener("abort", () => rej(new Error("aborted")));
    }));
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 30, fetchImpl: slow as any });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "timeout" });
  });
  it("ollama: network error", async () => {
    const c = ollamaClassifier({ url: "http://x", model: "m", timeoutMs: 1000, fetchImpl: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as any });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "network_error", source: "ollama" });
  });
});
