import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CalendarDays, Clock3, Globe2, Check } from "lucide-react";
import { api, ApiError, type AppState, type Cadence } from "../lib/api";
import { browserTimeZone, cadenceLabel, clock, dayLabel } from "../lib/format";
import { Button } from "../components/Button";
import { Photo } from "../components/Photo";

/** Schedule tab (ref 3 "Task Schedule"): persisted via PUT /api/schedule; the server computes next_due_at. */
export function Schedule({ state, onSaved }: { state: AppState; onSaved: (msg: string) => void }) {
  const s = state.schedule;
  const [time, setTime] = useState(s?.time_local ?? "18:30");
  const [cadence, setCadence] = useState<Cadence>(s?.cadence ?? "daily");
  const [soon, setSoon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (s) { setTime(s.time_local); setCadence(s.cadence); } }, [s?.time_local, s?.cadence]);
  const tz = s?.timezone ?? browserTimeZone();

  // The next seven calendar days, marked where this cadence has a check-in.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(state.now + i * 86_400_000);
    const wd = d.getDay();
    return {
      key: i, wd: d.toLocaleDateString("en-US", { weekday: "short" }), date: d.getDate(),
      on: cadence === "daily" || (wd !== 0 && wd !== 6), today: i === 0,
    };
  });

  // Upcoming: the first is the server's next_due_at; later ones follow the saved cadence.
  const upcoming: number[] = [];
  if (s?.next_due_at) {
    let t = s.next_due_at;
    upcoming.push(t);
    while (upcoming.length < 3) {
      t += 86_400_000;
      const wd = new Date(t).getDay();
      if (s.cadence === "weekdays" && (wd === 0 || wd === 6)) continue;
      upcoming.push(t);
    }
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await api.saveSchedule({ cadence, time_local: time, timezone: tz, enabled: true, first_due_in_seconds: soon ? 60 : undefined });
      setSaved(true); setSoon(false);
      onSaved(r.next_due_at ? `Saved. Next check-in ${dayLabel(r.next_due_at, Date.now()).toLowerCase()} at ${clock(r.next_due_at)}.` : "Saved.");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? "Can't reach Still's server." : "That time couldn't be saved.");
    } finally { setBusy(false); }
  }

  return (
    <section className="panel" aria-labelledby="sched-title">
      <div className="sched-head">
        <h1 id="sched-title" className="title">Check&#8209;in<br />schedule</h1>
        <span className="pill-soft"><CalendarDays size={18} /> {cadenceLabel(cadence)}</span>
      </div>

      <div className="days" aria-label="Next seven days">
        {days.map((d) => (
          <div className="day" key={d.key} data-on={d.on} data-today={d.today}>
            {d.wd}<i>{d.date}</i><span className="dot" aria-label={d.on ? "check-in" : "no check-in"} />
          </div>
        ))}
      </div>

      <div>
        <p className="label" style={{ margin: "0 0 10px" }}>Repeats</p>
        <div className="chips">
          {(["daily", "weekdays"] as const).map((c) => (
            <button key={c} className="chip-btn" aria-pressed={cadence === c} onClick={() => setCadence(c)}>{cadenceLabel(c)}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="label" style={{ margin: "0 0 10px" }}>Time</p>
        <div className="row">
          <label className="field"><Clock3 className="field-ico" size={20} /><span className="sr-only">Check-in time</span>
            <input type="time" value={time} required onChange={(e) => setTime(e.target.value)} /></label>
          <div className="field"><Globe2 className="field-ico" size={20} /><span style={{ fontWeight: 600 }}>{tz}</span></div>
        </div>
      </div>

      <label className="switch">
        <span>Make the first check&#8209;in due in 1 minute<small>For a demo. The server's scheduler creates it — nothing is faked.</small></span>
        <input type="checkbox" checked={soon} onChange={(e) => setSoon(e.target.checked)} aria-label="Make the first check-in due in 1 minute" />
      </label>

      <Button block onClick={save} disabled={busy}>{busy ? "Saving…" : s ? "Save schedule" : "Set check-in"}</Button>
      {saved && <motion.p className="notice" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}><Check size={14} style={{ verticalAlign: -2 }} /> Saved — see Today for the countdown.</motion.p>}
      {error && <p className="error" role="alert">{error}</p>}

      {upcoming.length > 0 && (
        <div>
          <p className="label" style={{ margin: "8px 0 10px" }}>Upcoming</p>
          <div className="upcoming">
            {upcoming.map((u, i) => {
              const [hm, ap] = clock(u).split(" ");
              return (
                <div className="slot" key={u}>
                  <div className="slot-time"><b>{hm}</b><span>{ap}</span></div>
                  <div><h4>Check&#8209;in</h4><p>{dayLabel(u, state.now)} · one question · about a minute</p></div>
                  <span className={`tag ${i === 0 ? "dark" : ""}`}>{i === 0 ? "Next" : cadenceLabel(s!.cadence)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function ScheduleSide() {
  return (
    <>
      <div className="float-card">
        <span className="float-pill">No notifications</span>
        <p className="small" style={{ padding: "0 6px" }}>When it's due, the check&#8209;in appears on Today and a green dot shows in the menu. Still never pings you.</p>
        <div className="float-photo"><Photo name="PACED_BREATHING" /></div>
      </div>
      <div className="end-note"><h3>Same time,<br />every day.</h3></div>
    </>
  );
}
