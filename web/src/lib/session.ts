// The only thing kept in browser storage: the opaque session token for the open check-in,
// so a reload doesn't strand it. Never the student's response text.
import type { StartResult } from "./api";

const KEY = "still.session";
export interface StoredSession { id: string; start: StartResult }

export function saveSession(s: StoredSession) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: session lives in memory only */ }
}
export function loadSession(): StoredSession | null {
  try { const raw = sessionStorage.getItem(KEY); return raw ? (JSON.parse(raw) as StoredSession) : null; } catch { return null; }
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
