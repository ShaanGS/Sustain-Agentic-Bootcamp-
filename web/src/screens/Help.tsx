import { ArrowRight } from "lucide-react";
import type { Helplines as H, RouteResult } from "../lib/api";
import { verifiedOn } from "../lib/format";

/** The two verified lines, from static configuration only. */
export function Helplines({ helplines }: { helplines: H }) {
  const { primary, emergency } = helplines;
  return (
    <div className="help-grid">
      <div className="line-card warm">
        <div className="line-top"><h3>{primary.name}</h3><span className="tag">{primary.tags?.join(" · ")}</span></div>
        <a className="big-number" href={`tel:${primary.numbers[0].tel}`} aria-label={`Call ${primary.name}, ${primary.numbers[0].display}`}>{primary.numbers[0].display}</a>
        <p>{primary.description}</p>
        {primary.numbers.slice(1).map((n) => <p key={n.tel}>Also <a href={`tel:${n.tel}`} style={{ textDecoration: "underline" }}>{n.display}</a></p>)}
        <span className="spacer" />
        <a className="btn btn-dark" href={`tel:${primary.numbers[0].tel}`} style={{ alignSelf: "flex-start" }}>
          <span>Call {primary.numbers[0].display}</span><span className="ico" aria-hidden><ArrowRight size={20} /></span>
        </a>
      </div>
      <div className="line-card dark">
        <div className="line-top"><h3>Immediate danger</h3><span className="tag">{emergency.tags?.join(" · ")}</span></div>
        <a className="big-number" href={`tel:${emergency.numbers[0].tel}`} aria-label={`Call emergency, ${emergency.numbers[0].display}`}>{emergency.numbers[0].display}</a>
        <p>{emergency.description}</p>
        <span className="spacer" />
        <a className="btn btn-light" href={`tel:${emergency.numbers[0].tel}`} style={{ alignSelf: "flex-start" }}>
          <span>Call {emergency.numbers[0].display}</span><span className="ico" aria-hidden><ArrowRight size={20} /></span>
        </a>
      </div>
    </div>
  );
}

const source = (h: H) => `Numbers from reviewed configuration · ${new URL(h.primary.source_url).host} · verified ${verifiedOn(h.primary.verified_on)}`;

/** Help tab: always reachable, does not touch any check-in. */
export function HelpTab({ helplines }: { helplines: H }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 className="title">Talk to a <span className="mark">person</span></h1>
      <p className="lead">Still is not a therapist or a crisis service. If you want to talk to someone, these are free public lines answered by people.</p>
      <Helplines helplines={helplines} />
      <p className="small">Still has not contacted anyone. Opening this page doesn't change your check&#8209;in. {source(helplines)}</p>
    </section>
  );
}

/**
 * Terminal crisis state. Replaces the whole interface; static content; no motion.
 */
export function Crisis({ result, onHome }: { result: Extract<RouteResult, { route: "help" }>; onHome: () => void }) {
  const asked = result.reason === "student_asked_for_person";
  return (
    <div className="page">
      <div className="sheet">
        <header className="header" style={{ gridTemplateColumns: "1fr auto" }}>
          <span className="brand">still<span>.</span></span>
          <span className="tag dark">Check&#8209;in stopped</span>
        </header>
        <main style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 28 }}>
          <h1 className="title">{asked ? "Talk to a person." : "Please talk to a person now."}</h1>
          <p className="stop-line">Still has stopped this check&#8209;in and has not contacted anyone.</p>
          <p className="lead">Still is not a crisis service. These free public helplines are answered by people.</p>
          <Helplines helplines={result.helplines} />
          <div className="help-foot">
            <p className="small">{source(result.helplines)}</p>
            <button className="btn btn-soft" onClick={onHome}>Return to Today</button>
          </div>
        </main>
      </div>
    </div>
  );
}
