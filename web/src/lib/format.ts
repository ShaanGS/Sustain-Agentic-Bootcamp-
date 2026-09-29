// Formatting of real timestamps. Nothing here invents a value.
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const browserTimeZone = tz;

export function timeParts(ms: number, timeZone?: string) {
  const f = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
  const parts = f.formatToParts(new Date(ms));
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  const ampm = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return { hm: `${hour}:${minute}`, ampm };
}

export function clock(ms: number, timeZone?: string) {
  const { hm, ampm } = timeParts(ms, timeZone);
  return `${hm} ${ampm}`;
}

function ymd(ms: number, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** "Today", "Tomorrow", or "Mon 5 Oct" relative to `now`. */
export function dayLabel(ms: number, now: number, timeZone?: string) {
  if (ymd(ms, timeZone) === ymd(now, timeZone)) return "Today";
  if (ymd(ms, timeZone) === ymd(now + 86_400_000, timeZone)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(ms));
}

/** "in 48 s", "in 12 min", "in 3 h 5 min". */
export function countdown(ms: number, now: number) {
  const s = Math.max(0, Math.round((ms - now) / 1000));
  if (s < 90) return `in ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `in ${h} h ${r} min` : `in ${h} h`;
}

export const cadenceLabel = (c: "daily" | "weekdays") => (c === "daily" ? "Every day" : "Weekdays");

export const fmtMs = (ms?: number) => (ms === undefined ? "—" : ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`);

export function verifiedOn(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
