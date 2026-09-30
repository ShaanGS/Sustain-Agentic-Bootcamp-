// Ephemeral, in-memory holding area for a check-in that is waiting on its one clarification.
// It exists only so the clarification step can re-check the ORIGINAL response's safety — a benign
// choice must never downgrade it. Never persisted, never logged, dropped on use, close or after 15 min.
import type { Context, Risk } from "./pipeline/classify/schema.js";

interface Pending { text: string; risk: Risk | "FAILED"; context: Context; expires: number }
const pending = new Map<string, Pending>();

export function holdForClarify(id: string, p: Omit<Pending, "expires">, now: number, ttlMs = 15 * 60_000) {
  sweep(now);
  pending.set(id, { ...p, expires: now + ttlMs });
}
/** Returns and removes the held response (one clarification per check-in). */
export function takeForClarify(id: string, now: number): Pending | undefined {
  sweep(now);
  const p = pending.get(id);
  pending.delete(id);
  return p;
}
export const dropHeld = (id: string) => { pending.delete(id); };
export const heldCount = () => pending.size;
function sweep(now: number) { for (const [k, v] of pending) if (v.expires <= now) pending.delete(k); }
export const clearHeld = () => { pending.clear(); };
