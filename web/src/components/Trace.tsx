import type { TraceStep } from "../lib/api";
import { fmtMs } from "../lib/format";

const NAMES: Record<TraceStep["step"], string> = {
  session: "Session",
  crisis_phrase: "Crisis phrase check",
  classifier: "Classifier",
  validate: "Validate output",
  policy: "Policy",
};

/** The completed server trace, shown as recorded. Nothing here is animated or estimated. */
export function Trace({ steps, totalMs, open = false }: { steps: TraceStep[]; totalMs: number; open?: boolean }) {
  return (
    <details className="trace" open={open}>
      <summary>
        <span>How Still decided</span>
        <span className="mono" style={{ fontSize: 12 }}>{steps.length} steps · {fmtMs(totalMs)}</span>
      </summary>
      {steps.map((s) => (
        <div className="trace-row" key={s.step}>
          <span className={`st st-${s.status}`} aria-hidden />
          <span>
            <span className="trace-name">{NAMES[s.step]}</span>
            <span className="trace-detail">{s.status.toUpperCase()} · {s.detail}</span>
          </span>
          <span className="trace-ms">{s.status === "skipped" ? "not run" : fmtMs(s.ms)}</span>
        </div>
      ))}
      <div className="trace-total"><span>Server time, measured</span><span>{fmtMs(totalMs)}</span></div>
    </details>
  );
}
