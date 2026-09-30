// Deterministic in-process classifier: the no-network, no-key fallback.
// Same contract as a model: risk first, then one need, then short context. Conservative by design.
import type { Classifier } from "./types.js";
import { normalise } from "../crisisPhrase.js";
import { validateClassifierOutput } from "./schema.js";
import { elapsed, mark } from "../../timing.js";

// Possible danger that isn't an explicit reviewed phrase → HIGH_RISK (over-inclusive on purpose).
const DANGER: RegExp[] = [
  /\b(pills?|tablets?|meds|medicines?|medication|paracetamol|sleeping pills?)\b.*\b(took|take|taken|swallow\w*|ate|all|whole|strip|bottle|too many|lot of|bunch)\b/,
  /\b(took|swallow\w*|ate|all|whole|strip|bottle|too many|bunch)\b.*\b(pills?|tablets?|meds|medicines?|paracetamol)\b/,
  /\b(bleach|poison\w*|pesticide|chemicals?|toxic|harmful)\b/,
  /\bswallow\w* (something|some|a lot|stuff)\b/,
  /\b(knife|blade|razor|rope|noose)\b/,
  /\b(jump|jumping) (off|from)\b/,
  /\b(not|dont feel|don t feel) safe\b/,
  /\b(hurt|harm|cut|burn)(ing)? (myself|my self|me)\b/,
  /\b(want|wanna|going) to (die|disappear forever)\b/,
  /\b(hitting|hits|beats|beating|hurting) me\b/,
];

/** Always-on safety layer: runs before any model, whichever provider is active. */
export const localDanger = (text: string) => DANGER.some((re) => re.test(normalise(text)));

// Not a check-in at all: asks Still to write or run code, change systems, or follow new instructions.
// Checked only after every safety layer is clear, so danger always wins. The model can also say OFF_TOPIC.
const NOT_A_CHECKIN: RegExp[] = [
  /\b(write|run|add|execute|create|build)\b.*\b(code|script|program|query|app)\b/,
  /\b(python|javascript|sql|bash)\b/,
  /\bignore\b.*\b(instructions|rules|prompt)\b/,
  /\bsystem prompt\b/,
  /\b(server|database|system)\b.*\b(access|change|delete|modify|break|take over|inject)\w*\b/,
];
export const notACheckin = (text: string) => NOT_A_CHECKIN.some((re) => re.test(normalise(text)));

// Distress language that is not a clear danger: never SAFE.
const CONCERNING = [
  "hopeless", "worthless", "empty inside", "give up on everything", "disappear", "no point",
  "hate myself", "burden", "trapped", "numb", "cant cope", "falling apart", "breaking down",
];

const RULES: Record<string, string[]> = {
  COMPETING_TASKS: [
    "assignments", "deadlines", "too much", "too many", "so much to do", "everything at once",
    "juggling", "jumping between", "all due", "due this week", "piling up", "backlog", "overloaded",
    "multiple", "three", "several", "exams and", "projects",
  ],
  DIFFICULTY_STARTING: [
    "cant start", "cant get started", "procrastinat", "putting off", "keep delaying", "cant focus",
    "cant concentrate", "stuck on", "blank page", "havent started", "motivation", "scrolling", "cant make myself",
    "instagram", "youtube", "keep opening", "avoiding",
  ],
  ACUTE_TENSION: [
    "nervous", "anxious", "tense", "wound up", "panick", "cant settle", "on edge", "heart racing",
    "restless", "shaky", "stressed about",
  ],
  FEELING_ISOLATED: [
    "lonely", "alone", "no friends", "left out", "isolated", "miss home", "homesick", "nobody to talk",
    "no one to talk", "disconnected", "ignored",
  ],
  SLEEP_OR_EXHAUSTION: [
    "sleep", "insomnia", "tired", "exhausted", "worn out", "drained", "no energy", "awake till",
    "up all night", "burnt out", "burned out", "fatigue",
  ],
  DOING_OK: [
    "im fine", "im okay", "im ok", "doing okay", "doing ok", "doing well", "pretty good", "all good",
    "good day", "feeling good", "nothing much", "not bad",
  ],
};

const DAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const DEADLINE = new RegExp(`\\b(tonight|today|tomorrow(?: morning| evening| night| afternoon)?|this week|next week|this weekend|(?:by |on |this )?${DAY}(?: morning| evening)?|in (?:an|one|two|\\d+) (?:hour|hours|days))\\b`);
const EVENT = /\b(viva|presentation|exam|exams|interview|test|quiz|lab report|essay|project|thesis|dissertation|assignment|coursework|seminar)\b/;
const COUNTED = /\b((?:\d+|two|three|four|five|six|several|multiple) (?:assignments|deadlines|exams|projects|tasks|essays|reports|submissions))\b/;

/** Deterministic, conservative extraction of short context from the normalised response. */
export function localContext(n: string) {
  const owned = n.match(/\b(tonights|todays|tomorrows|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays) (viva|presentation|exam|interview|test|quiz|seminar)\b/);
  if (owned) {
    const when = owned[1].replace(/s$/, "");
    return { situation: `${when}'s ${owned[2]}`, focus_target: null, deadline: when };
  }
  const deadline = n.match(DEADLINE)?.[1] ?? null;
  const counted = n.match(COUNTED)?.[1] ?? null;
  const event = n.match(EVENT)?.[1] ?? null;
  const situation = counted
    ? `${counted}${deadline ? ` due ${deadline.replace(/^(by|on) /, "")}` : ""}`
    : event ? `your ${event}${deadline ? ` ${deadline}` : ""}` : null;
  const focus_target = !counted && event ? `your ${event}${event.endsWith("s") ? "" : " prep"}` : null;
  return { situation, focus_target, deadline };
}

export function localRules(text: string): { risk: string; need_id: string | null; context?: object } {
  const n = normalise(text);
  if (DANGER.some((re) => re.test(n))) return { risk: "HIGH_RISK", need_id: null };
  if (CONCERNING.some((k) => n.includes(k))) return { risk: "UNCERTAIN", need_id: null };
  if (NOT_A_CHECKIN.some((re) => re.test(n))) return { risk: "OFF_TOPIC", need_id: null };
  let scores = Object.entries(RULES)
    .map(([need, keys]) => [need, keys.filter((k) => n.includes(k)).length] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  if (scores.length === 0) return { risk: "UNCERTAIN", need_id: null };
  if (scores.length > 1 && scores[0][1] === scores[1][1]) {
    // Starting difficulty beats task count when the student names an avoidance behaviour.
    const tie = scores.filter(([, s]) => s === scores[0][1]).map(([k]) => k);
    if (tie.includes("DIFFICULTY_STARTING") && tie.length === 2 && tie.includes("COMPETING_TASKS")) scores = [["DIFFICULTY_STARTING", 1]];
    else return { risk: "UNCERTAIN", need_id: null };
  }
  return { risk: "SAFE", need_id: scores[0][0], context: localContext(n) };
}

export function localClassifier(): Classifier {
  return {
    info: { provider: "local", model: "rules-v2", sends_text_off_machine: false, destination: "in-process (no network)" },
    async classify(text) {
      const t0 = mark();
      const raw = localRules(text);
      const ms = elapsed(t0);
      // Goes through the same validator as model output, so the allowlist and context limits still apply.
      const t1 = mark();
      const v = validateClassifierOutput(raw);
      return { source: "local", ms, validate_ms: elapsed(t1), ...v };
    },
  };
}
