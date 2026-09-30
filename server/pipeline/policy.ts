// Server-side policy: the single authority on what Still does next.
// The model supplies a risk level, one need id and short display context. It cannot pick the skill,
// the executor, its duration or any other parameter, and it never sees or produces a helpline.
import { needById, skillById, needs, type CrisisCategory, type Skill, type ExecutorType } from "../config.js";
import type { ClassifyResult } from "./classify/types.js";
import type { Context } from "./classify/schema.js";

/** The one bounded action handed to the client. Every field except `target` is server-defined. */
export interface Action {
  executor: ExecutorType;
  label: string;
  cta: string;
  duration_s?: number;
  target?: string;                               // FOCUS_TIMER only: what to work on (display text)
  message?: string;                              // COPY_MESSAGE only: reviewed template
  phases?: { label: string; seconds: number }[]; // BREATHING_GUIDE only
  rounds?: number;
  cues?: string[];                               // GUIDED_RESET only
}

export type HelpReason = "explicit_phrase" | "model_high_risk" | "recheck_high_risk" | "student_asked_for_person";
export type Decision =
  | { action: "help"; reason: HelpReason; kind: "emergency" | "support" }
  | { action: "skill"; need_id: string; understood: string; skill: Skill; act: Action; context: Context }
  | { action: "clarify"; reason: "uncertain" | "classifier_failed"; options: { need_id: string; label: string }[] };

export const clarifyOptions = () => needs.map((n) => ({ need_id: n.id, label: n.clarify_label }));

/** Builds the executor invocation from reviewed config. Only an allowlisted target string comes from context. */
export function buildAction(skill: Skill, context: Context): Action {
  const e = skill.executor;
  const base = { executor: e.type, label: e.label, cta: e.cta };
  switch (e.type) {
    case "FOCUS_TIMER": return { ...base, duration_s: e.duration_s, target: context.focus_target ?? e.default_target };
    case "BREATHING_GUIDE": return { ...base, duration_s: e.duration_s, phases: e.phases, rounds: e.rounds };
    case "GUIDED_RESET": return { ...base, duration_s: e.duration_s, cues: e.cues };
    case "COPY_MESSAGE": return { ...base, message: e.message };
    case "ACKNOWLEDGE": return base;
  }
}

export function skillForNeed(need_id: string, context: Context): Decision {
  const need = needById(need_id);
  const skill = need && skillById(need.skill_id);
  if (!need || !skill) return { action: "clarify", reason: "uncertain", options: clarifyOptions() };
  return { action: "skill", need_id: need.id, understood: need.label, skill, act: buildAction(skill, context), context };
}

/**
 * explicit: category of an explicit backstop hit (null if none).
 * result: validated classifier output, or null if the model was not called.
 */
export function decide(explicit: CrisisCategory | null, result: ClassifyResult | null): Decision {
  if (explicit) return { action: "help", reason: "explicit_phrase", kind: explicit === "emergency" ? "emergency" : "support" };
  if (!result || !result.ok) return { action: "clarify", reason: "classifier_failed", options: clarifyOptions() };
  if (result.risk === "HIGH_RISK") return { action: "help", reason: "model_high_risk", kind: "support" };
  if (result.risk === "SAFE" && result.need_id) return skillForNeed(result.need_id, result.context);
  return { action: "clarify", reason: "uncertain", options: clarifyOptions() };
}
