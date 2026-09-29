import type { TraceStep } from "../lib/api";
import { fmtMs } from "../lib/format";

const NAMES: Record<TraceStep["step"], string> = {
  session: "Session check", crisis_phrase: "Crisis phrase check", classifier: "Classifier", validate: "Validate output", policy: "Policy",
};

/** The completed server trace, exactly as recorded. */
export function Trace({ steps, totalMs }: { steps: TraceStep[]; totalMs: number }) {
  return (
    <div className="trace">
      {steps.map((s) => (
        <div className="trace-row" key={s.step}>
          <span className={`dot ${s.status}`} aria-hidden />
          <span><b>{NAMES[s.step]}</b><small>{s.status.toUpperCase()} · {s.detail}</small></span>
          <span className="ms">{s.status === "skipped" ? "not run" : fmtMs(s.ms)}</span>
        </div>
      ))}
      <div className="trace-total"><span>Measured on the server</span><span>{fmtMs(totalMs)}</span></div>
    </div>
  );
}
