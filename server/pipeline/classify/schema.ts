// The only shape a classifier may return. Anything else fails closed to UNCERTAIN — never SAFE.
import { z } from "zod";
import { NEED_IDS } from "../../config.js";
import { crisisPhraseHit } from "../crisisPhrase.js";

export const Risk = z.enum(["SAFE", "HIGH_RISK", "UNCERTAIN"]);
export type Risk = z.infer<typeof Risk>;

/**
 * Short, structured facts lifted from the response so the one action can be concrete.
 * Display-only, ephemeral (never persisted or logged), and never able to change the action.
 */
export interface Context {
  situation: string | null;     // e.g. "three assignments due Friday"
  focus_target: string | null;  // e.g. "your viva notes"
  deadline: string | null;      // e.g. "tomorrow morning"
}
const Fragment = z.string().max(120).nullable().optional();
const RawContext = z.object({ situation: Fragment, focus_target: Fragment, deadline: Fragment }).strict();

const Raw = z.object({
  risk: Risk,
  need_id: z.string().nullable().optional(),
  context: RawContext.nullable().optional(),
}).strict();

export type Validated =
  | { ok: true; risk: "SAFE"; need_id: string; context: Context }
  | { ok: true; risk: "UNCERTAIN" | "HIGH_RISK"; need_id: null; context: Context }
  | { ok: false; reason: string };

export const EMPTY_CONTEXT: Context = { situation: null, focus_target: null, deadline: null };

const MAX = 60;
/** Plain, short, single-line text only. Anything that looks like a link, markup or instructions is dropped. */
export function cleanFragment(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f<>{}\[\]`*_#|\\]/g, " ").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
  if (!t || t.length > MAX) return null;
  if (/https?:|www\.|\.com\b|@/i.test(t)) return null;
  if (/\b(you should|try to|please|call|contact|therapy|diagnos)/i.test(t)) return null; // no advice or claims
  return t;
}

/** Validates untrusted classifier output against the schema, the needs allowlist and the context limits. */
export function validateClassifierOutput(raw: unknown): Validated {
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema_mismatch" };
  const { risk, need_id } = parsed.data;
  const context: Context = {
    situation: cleanFragment(parsed.data.context?.situation),
    focus_target: cleanFragment(parsed.data.context?.focus_target),
    deadline: cleanFragment(parsed.data.context?.deadline),
  };
  // A model that echoes crisis language in its context is treated as HIGH_RISK.
  if (Object.values(context).some((f) => f && crisisPhraseHit(f))) return { ok: true, risk: "HIGH_RISK", need_id: null, context: EMPTY_CONTEXT };
  if (risk === "SAFE") {
    if (!need_id) return { ok: false, reason: "safe_without_need" };
    if (!NEED_IDS.includes(need_id)) return { ok: false, reason: "need_not_allowed" };
    return { ok: true, risk, need_id, context };
  }
  return { ok: true, risk, need_id: null, context: EMPTY_CONTEXT };
}

/** Parses model text that should be a single JSON object. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}
