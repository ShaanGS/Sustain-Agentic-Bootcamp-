import { describe, it, expect, vi } from "vitest";
import { crisisPhraseHit, crisisPhraseMatch } from "../server/pipeline/crisisPhrase.js";
import { validateClassifierOutput, cleanFragment } from "../server/pipeline/classify/schema.js";
import { decide, buildAction } from "../server/pipeline/policy.js";
import { localRules } from "../server/pipeline/classify/local.js";
import { groqClassifier } from "../server/pipeline/classify/groq.js";
import { ollamaClassifier } from "../server/pipeline/classify/ollama.js";
import { skills } from "../server/config.js";
import type { ClassifyResult } from "../server/pipeline/classify/types.js";

const CTX = { situation: null, focus_target: null, deadline: null };

describe("explicit safety backstop", () => {
  it.each([
    ["I don't want to be here anymore, I want to end my life.", "self_harm"],
    ["sometimes i think about suicide", "self_harm"],
    ["I keep wanting to HURT MYSELF", "self_harm"],
    ["I'm not going to kill myself but I think about it", "self_harm"], // negation still routes to help
    ["I ate poison with food.", "emergency"],
    ["I took too many pills", "emergency"],
    ["I overdosed last night", "emergency"],
    ["I hurt myself and I'm not safe.", "emergency"],
    ["I might hurt myself tonight.", "emergency"],
  ])("fires on %j (%s)", (t, cat) => expect(crisisPhraseMatch(t)).toBe(cat));

  it.each([
    "I have three assignments due this week and keep jumping between all of them.",
    "this deadline is killing me",
    "I could kill for a coffee right now",
    "ran 5 kms today and I'm tired",
    "we're going to jump off the stage at the end of the play",
  ])("does not fire on %j", (t) => expect(crisisPhraseHit(t)).toBe(false));
});

describe("model output validation (fail closed)", () => {
  it("accepts SAFE with an allowlisted need and clean context", () => {
    expect(validateClassifierOutput({ risk: "SAFE", need_id: "COMPETING_TASKS", context: { situation: "three assignments due Friday", focus_target: null, deadline: "Friday" } }))
      .toEqual({ ok: true, risk: "SAFE", need_id: "COMPETING_TASKS", context: { situation: "three assignments due Friday", focus_target: null, deadline: "Friday" } });
  });
  it.each([
    [{ risk: "SAFE", need_id: "MEDICATION_ADVICE" }, "need_not_allowed"],
    [{ risk: "SAFE" }, "safe_without_need"],
    [{ risk: "FINE", need_id: null }, "schema_mismatch"],
    [{ classification: "ORDINARY", need_id: "COMPETING_TASKS" }, "schema_mismatch"],
    [{ risk: "SAFE", need_id: "COMPETING_TASKS", advice: "do X" }, "schema_mismatch"],
    [{ risk: "SAFE", need_id: "COMPETING_TASKS", context: { situation: "x", tool: "send_email" } }, "schema_mismatch"],
    [{ risk: "SAFE", need_id: "COMPETING_TASKS", context: "three assignments" }, "schema_mismatch"],
    [{ risk: "SAFE", need_id: "COMPETING_TASKS", context: { situation: "x".repeat(200) } }, "schema_mismatch"],
    ["SAFE", "schema_mismatch"],
    [null, "schema_mismatch"],
  ])("rejects %j", (raw, reason) => {
    expect(validateClassifierOutput(raw)).toEqual({ ok: false, reason });
  });
  it("drops need and context for HIGH_RISK / UNCERTAIN", () => {
    expect(validateClassifierOutput({ risk: "HIGH_RISK", need_id: "COMPETING_TASKS", context: { situation: "x" } }))
      .toEqual({ ok: true, risk: "HIGH_RISK", need_id: null, context: CTX });
  });
  it("context that echoes crisis language is escalated to HIGH_RISK", () => {
    const v = validateClassifierOutput({ risk: "SAFE", need_id: "ACUTE_TENSION", context: { situation: "wants to end my life" } });
    expect(v).toMatchObject({ ok: true, risk: "HIGH_RISK" });
  });
  it.each([
    ["see https://evil.example", null],
    ["you should call your doctor", null],
    ["three assignments due Friday.", "three assignments due Friday"],
    ["<b>viva</b> notes", "b viva /b notes"],
  ])("cleans context fragment %j", (raw, out) => expect(cleanFragment(raw)).toBe(out));
});

describe("policy", () => {
  const r = (x: object) => ({ source: "local", ms: 1, ...x }) as ClassifyResult;
  it("an explicit phrase always wins, even over a SAFE label", () => {
    expect(decide("self_harm", r({ ok: true, risk: "SAFE", need_id: "COMPETING_TASKS", context: CTX })).action).toBe("help");
  });
  it("emergency phrases lead with 112", () => {
    expect(decide("emergency", null)).toEqual({ action: "help", reason: "explicit_phrase", kind: "emergency" });
  });
  it("model HIGH_RISK → help", () => {
    expect(decide(null, r({ ok: true, risk: "HIGH_RISK", need_id: null, context: CTX }))).toMatchObject({ action: "help", reason: "model_high_risk" });
  });
  it("model failure → clarify, never a skill", () => {
    const d = decide(null, r({ ok: false, reason: "timeout" }));
    expect(d).toMatchObject({ action: "clarify", reason: "classifier_failed" });
  });
  it("UNCERTAIN → clarify", () => {
    expect(decide(null, r({ ok: true, risk: "UNCERTAIN", need_id: null, context: CTX })).action).toBe("clarify");
  });
  it("SAFE → exactly the skill and executor from the tables; context only fills the display target", () => {
    const d = decide(null, r({ ok: true, risk: "SAFE", need_id: "DIFFICULTY_STARTING", context: { situation: "your viva tomorrow", focus_target: "viva notes", deadline: "tomorrow" } }));
    expect(d.action).toBe("skill");
    if (d.action !== "skill") return;
    expect(d.skill.id).toBe("START_SMALL");
    expect(d.act).toEqual({ executor: "FOCUS_TIMER", label: "10-minute focus", cta: "Start 10-minute focus", duration_s: 600, target: "viva notes" });
  });
});

describe("executors", () => {
  it("every skill has exactly one allowlisted executor with bounded parameters", () => {
    for (const s of skills) {
      expect(["FOCUS_TIMER", "BREATHING_GUIDE", "COPY_MESSAGE", "GUIDED_RESET", "ACKNOWLEDGE"]).toContain(s.executor.type);
      if (s.executor.duration_s !== undefined) expect(s.executor.duration_s).toBeLessThanOrEqual(1800);
    }
  });
  it("buildAction emits only allowlisted fields — no URLs, tools or free parameters", () => {
    const allowed = new Set(["executor", "label", "cta", "duration_s", "target", "message", "phases", "rounds", "cues"]);
    for (const s of skills) {
      const a = buildAction(s, { situation: "x", focus_target: "y", deadline: "z" });
      for (const k of Object.keys(a)) expect(allowed.has(k)).toBe(true);
      expect(JSON.stringify(a)).not.toMatch(/https?:|mailto:|tel:/);
    }
  });
  it("breathing guide is deterministic: 6 rounds of 4 in / 6 out = 60 s", () => {
    const a = buildAction(skills.find((s) => s.id === "PACED_BREATHING")!, CTX);
    expect(a.phases!.reduce((n, p) => n + p.seconds, 0) * a.rounds!).toBe(a.duration_s);
  });
});

describe("local classifier", () => {
  it.each([
    ["I have three assignments due this week and keep jumping between all of them.", "COMPETING_TASKS"],
    ["I have my viva tomorrow morning and I haven't started preparing. I keep opening Instagram instead.", "DIFFICULTY_STARTING"],
    ["I'm really wound up about tomorrow's presentation and can't settle.", "ACUTE_TENSION"],
    ["I keep putting off my lab report, haven't started at all", "DIFFICULTY_STARTING"],
    ["I've been up all night for days and I'm exhausted", "SLEEP_OR_EXHAUSTION"],
    ["Everyone went home for the weekend and I feel lonely", "FEELING_ISOLATED"],
    ["honestly I'm doing okay today", "DOING_OK"],
  ])("%j → %s", (t, need) => expect(localRules(t)).toMatchObject({ risk: "SAFE", need_id: need }));

  it("extracts short context", () => {
    expect(localRules("I have three assignments due this week and keep jumping between all of them.").context)
      .toEqual({ situation: "three assignments due this week", focus_target: null, deadline: "this week" });
    expect(localRules("I'm wound up about tomorrow's presentation and can't settle.").context)
      .toMatchObject({ situation: "tomorrow's presentation" });
  });

  it.each([
    "I swallowed something poisonous.",
    "I swallowed a whole strip of my mom's sleeping tablets",
    "I took all my meds at once",
    "I don't feel safe at all",
    "my roommate keeps hitting me",
  ])("%j → HIGH_RISK", (t) => expect(localRules(t).risk).toBe("HIGH_RISK"));

  it.each(["I feel hopeless about everything", "banana", "idk"])("%j → UNCERTAIN", (t) => {
    expect(localRules(t).risk).toBe("UNCERTAIN");
  });
});

describe("model providers fail closed", () => {
  const ok = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })));

  it("groq: valid SAFE passes with context", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"risk":"SAFE","need_id":"COMPETING_TASKS","context":{"situation":"three assignments due Friday","focus_target":null,"deadline":"Friday"}}') });
    expect(await c.classify("x")).toMatchObject({ ok: true, risk: "SAFE", need_id: "COMPETING_TASKS", source: "groq", context: { situation: "three assignments due Friday" } });
  });
  it("groq: HIGH_RISK passes through", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"risk":"HIGH_RISK","need_id":null,"context":null}') });
    expect(await c.classify("x")).toMatchObject({ ok: true, risk: "HIGH_RISK" });
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
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"risk":"SAFE","need_id":"THERAPY"}') });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "need_not_allowed" });
  });
  it("groq: model tries to request a tool → rejected", async () => {
    const c = groqClassifier({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: ok('{"risk":"SAFE","need_id":"COMPETING_TASKS","action":"send_email","url":"http://x"}') });
    expect(await c.classify("x")).toMatchObject({ ok: false, reason: "schema_mismatch" });
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
