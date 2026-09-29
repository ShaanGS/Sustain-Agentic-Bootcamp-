import type { Helplines, RouteResult } from "../lib/api";
import { verifiedOn } from "../lib/format";

type HelpResult = Extract<RouteResult, { route: "help" }>;

/**
 * Terminal human-help state. Static content from reviewed configuration only:
 * no generated text, no skill, no motion. It replaces the whole check-in interface.
 */
export function Help({ result, onHome }: { result: HelpResult; onHome: () => void }) {
  const { primary, emergency } = result.helplines as Helplines;
  const asked = result.reason === "student_asked_for_person";
  return (
    <div className="frame">
      <div className="sheet">
        <header className="topbar" style={{ gridTemplateColumns: "1fr auto" }}>
          <span className="wordmark"><span className="wordmark-dot" aria-hidden />Still</span>
          <span className="label">Check-in paused</span>
        </header>
        <main className="main">
          <section className="help" aria-labelledby="help-title">
            <p className="eyebrow">Human support</p>
            <h1 id="help-title" className="headline">
              {asked ? "Talk to a person." : "Please talk to a person now."}
            </h1>
            <p className="help-stop">Still has stopped this check-in and has not contacted anyone.</p>
            <p className="lead" style={{ marginTop: "var(--s-2)" }}>
              Still is not a crisis service. These are free public helplines answered by people.
            </p>

            <div className="help-lines">
              <div className="help-line">
                <p className="help-name">{primary.name}</p>
                <a className="help-number" href={`tel:${primary.numbers[0].tel}`} aria-label={`Call ${primary.name}, ${primary.numbers[0].display}`}>
                  {primary.numbers[0].display}
                </a>
                <p className="help-desc">{primary.description}</p>
                {primary.numbers.slice(1).map((n) => (
                  <span className="help-alt" key={n.tel}>Also <a href={`tel:${n.tel}`}>{n.display}</a></span>
                ))}
                <a className="btn btn-primary btn-plain" style={{ width: "fit-content", marginTop: "var(--s-3)" }} href={`tel:${primary.numbers[0].tel}`}>
                  Call {primary.numbers[0].display}
                </a>
              </div>
              <div className="help-line">
                <p className="help-name">Immediate danger</p>
                <a className="help-number" href={`tel:${emergency.numbers[0].tel}`} aria-label={`Call emergency, ${emergency.numbers[0].display}`}>
                  {emergency.numbers[0].display}
                </a>
                <p className="help-desc">{emergency.description}</p>
                <a className="btn btn-outline btn-plain" style={{ width: "fit-content", marginTop: "var(--s-3)" }} href={`tel:${emergency.numbers[0].tel}`}>
                  Call {emergency.numbers[0].display}
                </a>
              </div>
            </div>

            <div className="help-foot">
              <div>
                <p style={{ margin: 0 }}><strong>This check-in has ended.</strong> Still has not contacted anyone.</p>
                <p className="meta" style={{ margin: "4px 0 0" }}>
                  Numbers from reviewed configuration · {new URL(primary.source_url).host} · verified {verifiedOn(primary.verified_on)}
                </p>
              </div>
              <button className="btn btn-outline btn-plain" onClick={onHome}>Return home</button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
