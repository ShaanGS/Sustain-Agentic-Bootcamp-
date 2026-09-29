// Server-side policy: the single authority on what Still does next.
// Neither the model nor the UI can choose a skill or a resource.
import { needById, skillById, needs, type Skill } from "../config.js";
import type { ClassifyResult } from "./classify/types.js";

export type Decision =
  | { action: "help"; reason: "crisis_phrase" | "classifier_crisis" | "student_asked_for_person" }
  | { action: "skill"; need_id: string; matched_label: string; skill: Skill }
  | { action: "clarify"; reason: "uncertain" | "classifier_failed"; options: { need_id: string; label: string }[] };

export const clarifyOptions = () => needs.map((n) => ({ need_id: n.id, label: n.clarify_label }));

export function skillForNeed(need_id: string): Decision {
  const need = needById(need_id);
  const skill = need && skillById(need.skill_id);
  if (!need || !skill) return { action: "clarify", reason: "uncertain", options: clarifyOptions() };
  return { action: "skill", need_id: need.id, matched_label: need.label, skill };
}

/**
 * phraseHit: result of the explicit phrase backstop.
 * result: validated classifier output, or null if the classifier was not run.
 */
export function decide(phraseHit: boolean, result: ClassifyResult | null): Decision {
  if (phraseHit) return { action: "help", reason: "crisis_phrase" };
  if (!result || !result.ok) return { action: "clarify", reason: "classifier_failed", options: clarifyOptions() };
  if (result.classification === "CRISIS") return { action: "help", reason: "classifier_crisis" };
  if (result.classification === "ORDINARY" && result.need_id) return skillForNeed(result.need_id);
  return { action: "clarify", reason: "uncertain", options: clarifyOptions() };
}
