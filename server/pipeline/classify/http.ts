// Shared fail-closed wrapper for HTTP model providers.
import { parseJsonObject, validateClassifierOutput, type Validated } from "./schema.js";
import { elapsed, mark } from "../../timing.js";

export type Timed = Validated & { validate_ms?: number };

export async function callModel(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<Response>,
  extract: (body: any) => unknown,
): Promise<Timed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(controller.signal);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = await res.json();
    let content: unknown;
    try { content = extract(body); } catch { return { ok: false, reason: "bad_response" }; }
    if (typeof content !== "string") return { ok: false, reason: "bad_response" };
    let parsed: unknown;
    try { parsed = parseJsonObject(content); } catch { return { ok: false, reason: "bad_json" }; }
    const t = mark();
    const v = validateClassifierOutput(parsed);
    return { ...v, validate_ms: elapsed(t) };
  } catch (e) {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
