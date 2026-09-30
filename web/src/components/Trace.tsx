import type { TraceStep } from "../lib/api";
import { fmtMs } from "../lib/format";

export const STEP_NAMES: Record<TraceStep["step"], string> = {
  trigger: "Trigger", observe: "Observe", safety: "Safety", model: "Model", understand: "Understand", decide: "Decide", act: "Act", end: "End",
};

/** The server's agent trace for this check-in, exactly as recorded (labels, not reasoning). */
export function Trace({ steps, totalMs }: { steps: TraceStep[]; totalMs: number }) {
  return (
    <div className="trace">
      {steps.map((s) => (
        <div className="trace-row" key={s.step}>
          <span className={`dot ${s.status}`} aria-hidden />
          <span><b>{STEP_NAMES[s.step]} · {s.label}</b><small>{s.detail}</small></span>
          <span className="ms">{s.status === "skipped" ? "not run" : s.status === "pending" ? "waiting" : fmtMs(s.ms)}</span>
        </div>
      ))}
      <div className="trace-total"><span>Measured on the server</span><span>{fmtMs(totalMs)}</span></div>
    </div>
  );
}
