// Timezone-aware "next HH:MM" arithmetic without dependencies.

function partsIn(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Offset (ms) of `timeZone` from UTC at instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to an epoch ms instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - offsetAt(guess, timeZone);
  ms = guess - offsetAt(ms, timeZone); // second pass settles DST edges
  return ms;
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export type Cadence = "daily" | "weekdays";

/** First instant strictly after `fromMs` matching HH:MM on an allowed day in `timeZone`. */
export function computeNextDue(cadence: Cadence, timeLocal: string, timeZone: string, fromMs: number): number {
  const [h, mi] = timeLocal.split(":").map(Number);
  const today = partsIn(fromMs, timeZone);
  for (let i = 0; i < 9; i++) {
    const cal = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const weekday = cal.getUTCDay(); // 0 Sun … 6 Sat
    if (cadence === "weekdays" && (weekday === 0 || weekday === 6)) continue;
    const at = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), h, mi, timeZone);
    if (at > fromMs) return at;
  }
  throw new Error("computeNextDue: no slot found");
}
