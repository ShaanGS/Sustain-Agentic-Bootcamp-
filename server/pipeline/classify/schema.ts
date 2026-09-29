// The only shape a classifier is allowed to return. Anything else fails closed.
import { z } from "zod";
import { NEED_IDS } from "../../config.js";

export const Classification = z.enum(["ORDINARY", "UNCERTAIN", "CRISIS"]);
export type Classification = z.infer<typeof Classification>;

const Raw = z.object({
  classification: Classification,
  need_id: z.string().nullable().optional(),
}).strict();

export type Validated =
  | { ok: true; classification: "ORDINARY"; need_id: string }
  | { ok: true; classification: "UNCERTAIN" | "CRISIS"; need_id: null }
  | { ok: false; reason: string };

/** Validates untrusted classifier output against the schema and the needs allowlist. */
export function validateClassifierOutput(raw: unknown): Validated {
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema_mismatch" };
  const { classification, need_id } = parsed.data;
  if (classification === "ORDINARY") {
    if (!need_id) return { ok: false, reason: "ordinary_without_need" };
    if (!NEED_IDS.includes(need_id)) return { ok: false, reason: "need_not_allowed" };
    return { ok: true, classification, need_id };
  }
  return { ok: true, classification, need_id: null };
}

/** Parses model text that should be a single JSON object. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}
