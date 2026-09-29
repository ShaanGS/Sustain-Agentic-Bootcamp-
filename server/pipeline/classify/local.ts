// Deterministic in-process rules classifier: the no-network, no-key fallback.
// It is deliberately conservative — no clear single match means UNCERTAIN.
import type { Classifier } from "./types.js";
import { normalise } from "../crisisPhrase.js";
import { validateClassifierOutput } from "./schema.js";
import { elapsed, mark } from "../../timing.js";

// Distress language that is not an explicit crisis phrase: never ORDINARY.
const CONCERNING = [
  "hopeless", "worthless", "empty inside", "give up on everything", "disappear", "no point",
  "hate myself", "burden", "trapped", "numb", "cant cope", "falling apart", "breaking down",
];

const RULES: Record<string, string[]> = {
  too_many_tasks: [
    "assignments", "deadlines", "too much", "too many", "so much to do", "everything at once",
    "juggling", "jumping between", "all due", "due this week", "piling up", "backlog", "overloaded",
    "multiple", "three", "several", "exams and", "projects",
  ],
  cant_get_started: [
    "cant start", "cant get started", "procrastinat", "putting off", "keep delaying", "cant focus",
    "cant concentrate", "stuck on", "blank page", "havent started", "motivation", "scrolling", "cant make myself",
  ],
  wound_up: [
    "nervous", "anxious", "tense", "wound up", "panick", "cant settle", "on edge", "heart racing",
    "presentation", "exam tomorrow", "viva", "interview", "restless", "shaky", "stressed about",
  ],
  feeling_cut_off: [
    "lonely", "alone", "no friends", "left out", "isolated", "miss home", "homesick", "nobody to talk",
    "no one to talk", "disconnected", "ignored",
  ],
  sleep_or_worn_out: [
    "sleep", "insomnia", "tired", "exhausted", "worn out", "drained", "no energy", "awake till",
    "up all night", "burnt out", "burned out", "fatigue",
  ],
  doing_ok: [
    "im fine", "im okay", "im ok", "doing okay", "doing ok", "doing well", "pretty good", "all good",
    "good day", "feeling good", "nothing much", "not bad",
  ],
};

export function localRules(text: string): { classification: string; need_id: string | null } {
  const n = normalise(text);
  if (CONCERNING.some((k) => n.includes(k))) return { classification: "UNCERTAIN", need_id: null };
  const scores = Object.entries(RULES)
    .map(([need, keys]) => [need, keys.filter((k) => n.includes(k)).length] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  if (scores.length === 0) return { classification: "UNCERTAIN", need_id: null };
  if (scores.length > 1 && scores[0][1] === scores[1][1]) return { classification: "UNCERTAIN", need_id: null };
  return { classification: "ORDINARY", need_id: scores[0][0] };
}

export function localClassifier(): Classifier {
  return {
    info: { provider: "local", model: "rules-v1", sends_text_off_machine: false, destination: "in-process (no network)" },
    async classify(text) {
      const t0 = mark();
      const raw = localRules(text);
      const ms = elapsed(t0);
      // Goes through the same validator as model output, so the allowlist still applies.
      const t1 = mark();
      const v = validateClassifierOutput(raw);
      return { source: "local", ms, validate_ms: elapsed(t1), ...v };
    },
  };
}
