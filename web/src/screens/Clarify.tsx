import { ArrowRight, Phone } from "lucide-react";
import type { RouteResult } from "../lib/api";

type ClarifyResult = Extract<RouteResult, { route: "clarify" }>;

/** One tap from fixed options. No second free-text round. */
export function Clarify({ result, busy, onChoose, onClose }: {
  result: ClarifyResult;
  busy: boolean;
  onChoose: (choice: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="focus">
      <div className="focus-inner">
        <p className="eyebrow"><span className="dot" />One question</p>
        <h1 className="prompt-q">Which feels <span className="serif">closest</span>?</h1>
        <p className="lead">
          {result.reason === "classifier_failed"
            ? "Still couldn't read that reliably, so it's asking instead of guessing."
            : "Still wasn't sure which step fits, so it's asking instead of guessing."}
        </p>
        <ul className="options">
          {result.options.map((o, i) => (
            <li key={o.need_id}>
              <button className="option" disabled={busy} onClick={() => onChoose(o.need_id)}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <span>{o.label}</span>
                <ArrowRight className="go" size={20} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button className="option option-person" disabled={busy} onClick={() => onChoose("talk_to_person")}>
              <Phone size={18} strokeWidth={1.75} aria-hidden style={{ justifySelf: "start" }} />
              <span>I'd rather talk to a person</span>
              <ArrowRight className="go" size={20} strokeWidth={1.5} aria-hidden />
            </button>
          </li>
        </ul>
        <div style={{ marginTop: "var(--s-5)" }}>
          <button className="text-btn" onClick={onClose} disabled={busy}>Close without choosing</button>
        </div>
      </div>
    </section>
  );
}
