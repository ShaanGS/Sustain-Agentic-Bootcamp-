import { describe, it, expect } from "vitest";
import { computeNextDue, zonedToUtc } from "../server/time.js";
import { openDb } from "../server/db.js";
import { saveSchedule, tick, createDueCheckin, getOpenCheckin, getSchedule } from "../server/scheduler.js";

const IST = "Asia/Kolkata";

describe("computeNextDue", () => {
  it("returns today's slot if still ahead (IST)", () => {
    const from = zonedToUtc(2026, 9, 29, 10, 0, IST); // Tue 10:00 IST
    expect(computeNextDue("daily", "18:30", IST, from)).toBe(zonedToUtc(2026, 9, 29, 18, 30, IST));
    expect(new Date(computeNextDue("daily", "18:30", IST, from)).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });
  it("rolls to tomorrow once the slot has passed", () => {
    const from = zonedToUtc(2026, 9, 29, 19, 0, IST);
    expect(computeNextDue("daily", "18:30", IST, from)).toBe(zonedToUtc(2026, 9, 30, 18, 30, IST));
  });
  it("weekdays skips Saturday and Sunday", () => {
    const fri = zonedToUtc(2026, 10, 2, 20, 0, IST); // Fri evening
    expect(computeNextDue("weekdays", "18:30", IST, fri)).toBe(zonedToUtc(2026, 10, 5, 18, 30, IST)); // Mon
  });
  it("handles DST zones", () => {
    const from = zonedToUtc(2026, 3, 7, 12, 0, "America/New_York");
    expect(computeNextDue("daily", "09:00", "America/New_York", from))
      .toBe(Date.parse("2026-03-08T13:00:00Z")); // DST starts Mar 8 → EDT (UTC-4)
  });
});

describe("scheduler", () => {
  const t0 = zonedToUtc(2026, 9, 29, 10, 0, IST);

  it("creates a real ready check-in when due and advances next_due_at", () => {
    const db = openDb(":memory:");
    saveSchedule(db, { cadence: "daily", time_local: "18:30", timezone: IST, enabled: true, first_due_in_seconds: 60 }, t0);
    expect(tick(db, t0 + 30_000).fired).toBe(false);
    expect(getOpenCheckin(db)).toBeUndefined();
    expect(tick(db, t0 + 61_000)).toEqual({ fired: true, created: true });
    const c = getOpenCheckin(db)!;
    expect(c.status).toBe("ready");
    expect(c.source).toBe("scheduled");
    expect(getSchedule(db)!.next_due_at).toBe(zonedToUtc(2026, 9, 29, 18, 30, IST));
  });

  it("'check in now' uses the same path and never duplicates an open check-in", () => {
    const db = openDb(":memory:");
    const a = createDueCheckin(db, "manual", t0);
    const b = createDueCheckin(db, "manual", t0 + 1000);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.checkin.id).toBe(a.checkin.id);
  });

  it("disabled schedule never fires", () => {
    const db = openDb(":memory:");
    saveSchedule(db, { cadence: "daily", time_local: "10:01", timezone: IST, enabled: false }, t0);
    expect(tick(db, t0 + 86_400_000).fired).toBe(false);
  });

  it("ready check-ins expire after the window", () => {
    const db = openDb(":memory:");
    createDueCheckin(db, "manual", t0);
    tick(db, t0 + 13 * 3_600_000);
    expect(getOpenCheckin(db)).toBeUndefined();
    const row = db.prepare("SELECT status FROM checkins").get() as { status: string };
    expect(row.status).toBe("expired");
  });
});
