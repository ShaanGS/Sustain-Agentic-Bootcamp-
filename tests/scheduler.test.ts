import { describe, it, expect } from "vitest";
import { computeNextDue, zonedToUtc } from "../server/time.js";
import { makeStore } from "./store.js";
import { saveSchedule, tick, createDueCheckin, getOpenCheckin, getSchedule } from "../server/scheduler.js";

const IST = "Asia/Kolkata";

describe("computeNextDue", () => {
  it("returns today's slot if still ahead (IST)", async () => {
    const from = zonedToUtc(2026, 9, 29, 10, 0, IST); // Tue 10:00 IST
    expect(computeNextDue("daily", "18:30", IST, from)).toBe(zonedToUtc(2026, 9, 29, 18, 30, IST));
    expect(new Date(computeNextDue("daily", "18:30", IST, from)).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });
  it("rolls to tomorrow once the slot has passed", async () => {
    const from = zonedToUtc(2026, 9, 29, 19, 0, IST);
    expect(computeNextDue("daily", "18:30", IST, from)).toBe(zonedToUtc(2026, 9, 30, 18, 30, IST));
  });
  it("weekdays skips Saturday and Sunday", async () => {
    const fri = zonedToUtc(2026, 10, 2, 20, 0, IST); // Fri evening
    expect(computeNextDue("weekdays", "18:30", IST, fri)).toBe(zonedToUtc(2026, 10, 5, 18, 30, IST)); // Mon
  });
  it("handles DST zones", async () => {
    const from = zonedToUtc(2026, 3, 7, 12, 0, "America/New_York");
    expect(computeNextDue("daily", "09:00", "America/New_York", from))
      .toBe(Date.parse("2026-03-08T13:00:00Z")); // DST starts Mar 8 → EDT (UTC-4)
  });
});

describe("scheduler", () => {
  const t0 = zonedToUtc(2026, 9, 29, 10, 0, IST);

  it("creates a real ready check-in when due and advances next_due_at", async () => {
    const db = await makeStore();
    await saveSchedule(db, { cadence: "daily", time_local: "18:30", timezone: IST, enabled: true, first_due_in_seconds: 60 }, t0);
    expect((await tick(db, t0 + 30_000)).fired).toBe(false);
    expect(await getOpenCheckin(db)).toBeUndefined();
    expect(await tick(db, t0 + 61_000)).toEqual({ fired: true, created: true });
    const c = (await getOpenCheckin(db))!;
    expect(c.status).toBe("ready");
    expect(c.source).toBe("scheduled");
    expect((await getSchedule(db))!.next_due_at).toBe(zonedToUtc(2026, 9, 29, 18, 30, IST));
  });

  it("'check in now' uses the same path and never duplicates an open check-in", async () => {
    const db = await makeStore();
    const a = await createDueCheckin(db, "manual", t0);
    const b = await createDueCheckin(db, "manual", t0 + 1000);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.checkin.id).toBe(a.checkin.id);
  });

  it("disabled schedule never fires", async () => {
    const db = await makeStore();
    await saveSchedule(db, { cadence: "daily", time_local: "10:01", timezone: IST, enabled: false }, t0);
    expect((await tick(db, t0 + 86_400_000)).fired).toBe(false);
  });

  it("ready check-ins expire after the window", async () => {
    const db = await makeStore();
    await createDueCheckin(db, "manual", t0);
    await tick(db, t0 + 13 * 3_600_000);
    expect(await getOpenCheckin(db)).toBeUndefined();
    const row = (await db.get("SELECT status FROM checkins")) as { status: string };
    expect(row.status).toBe("expired");
  });
});
