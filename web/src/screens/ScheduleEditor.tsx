import { useState } from "react";
import { api, ApiError, type Cadence, type Schedule } from "../lib/api";
import { browserTimeZone } from "../lib/format";
import { Button } from "../components/Button";

/** Persists the schedule via PUT /api/schedule. The server computes next_due_at. */
export function ScheduleEditor({ initial, onSaved, onCancel, submitLabel = "Set check-in" }: {
  initial?: Schedule | null;
  onSaved: (s: Schedule) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [time, setTime] = useState(initial?.time_local ?? "18:30");
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? "daily");
  const [soon, setSoon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone = browserTimeZone();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.saveSchedule({ cadence, time_local: time, timezone, enabled: true, first_due_in_seconds: soon ? 60 : undefined });
      onSaved(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? "Can't reach Still's server." : "That time couldn't be saved. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sched" onSubmit={save}>
      <div className="sched-row">
        <label className="field">
          <span className="label">Time</span>
          <input className="time-input" type="time" value={time} required onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="field">
          <span className="label" id="cadence-label">Repeats</span>
          <div className="seg" role="group" aria-labelledby="cadence-label">
            {(["daily", "weekdays"] as const).map((c) => (
              <button type="button" key={c} aria-pressed={cadence === c} onClick={() => setCadence(c)}>
                {c === "daily" ? "Every day" : "Weekdays"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={soon} onChange={(e) => setSoon(e.target.checked)} />
        Make the first check-in due in 1 minute
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--s-5)" }}>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        {onCancel && <button type="button" className="text-btn" onClick={onCancel}>Cancel</button>}
        <span className="tz">{timezone}</span>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </form>
  );
}
