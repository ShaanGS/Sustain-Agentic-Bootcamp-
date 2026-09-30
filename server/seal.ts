// Stateless hold for the one clarification. The original response is sealed with AES-256-GCM and
// handed to the browser, which keeps it in page memory only and sends it back with the choice.
// The server can then re-check the ORIGINAL response's safety without ever storing it — this works
// across serverless instances. Bound to the check-in id; expires after 15 minutes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Risk } from "./pipeline/classify/schema.js";
import { log } from "./log.js";

export interface Held { text: string; risk: Risk | "FAILED" }

let key: Buffer | null = null;
function getKey() {
  if (key) return key;
  const secret = process.env.STILL_SECRET;
  if (!secret && process.env.VERCEL) log("config.warning", { msg: "STILL_SECRET not set; clarification holds only work within one instance" });
  key = createHash("sha256").update(secret || randomBytes(32).toString("hex")).digest();
  return key;
}

export function seal(held: Held, checkinId: string, now: number, ttlMs = 15 * 60_000): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  c.setAAD(Buffer.from(checkinId));
  const body = Buffer.concat([c.update(JSON.stringify({ ...held, exp: now + ttlMs }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

/** Returns the held response, or null if missing, tampered with, for another check-in, or expired. */
export function unseal(blob: unknown, checkinId: string, now: number): Held | null {
  if (typeof blob !== "string" || blob.length < 40 || blob.length > 4096) return null;
  try {
    const raw = Buffer.from(blob, "base64url");
    const d = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
    d.setAAD(Buffer.from(checkinId));
    d.setAuthTag(raw.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
    if (typeof v.text !== "string" || typeof v.exp !== "number" || v.exp <= now) return null;
    return { text: v.text, risk: v.risk };
  } catch {
    return null;
  }
}
