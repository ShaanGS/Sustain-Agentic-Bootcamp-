import { useEffect, useState } from "react";
import { api, type Protocol as P, type TraceStep } from "../lib/api";
import { ago, fmtMs, verifiedOn } from "../lib/format";
import { useNow } from "../lib/useLive";

const TITLES: Record<string, string> = {
  session: "Session", crisis_phrase: "Crisis phrase", classifier: "Classify",
  validate: "Validate", policy: "Policy", close: "Close",
};

/** One screen, built entirely from GET /api/protocol. Refreshes so it follows a live demo. */
export function Protocol() {
  const [p, setP] = useState<P | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.protocol().then((x) => { if (alive) { setP(x); setErr(false); } }).catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const now = useNow(undefined, 1000);

  if (!p) return <section className="proto"><p className="empty">{err ? "Can't reach Still's server." : "Loading protocol…"}</p></section>;

  const last = p.recent_runs[0];
  const statusFor = (step: string): TraceStep | undefined => last?.steps.find((s) => s.step === step);
  const skillTitle = (id: string) => p.skills.find((s) => s.id === id)?.title ?? id;

  return (
    <section className="proto">
      <div className="proto-head">
        <div>
          <p className="eyebrow">Protocol · how Still works</p>
          <h1 className="proto-title">One question. One reviewed step. <span className="serif">Then it stops.</span></h1>
        </div>
        <div className="sys-card">
          <span className="sys-label">Active classifier</span>
          <p className="sys-big">{p.classifier.provider} · {p.classifier.model}</p>
          <dl className="sys-kv">
            <dt>Runs at</dt><dd>{p.classifier.destination}</dd>
            <dt>Response text</dt>
            <dd>{p.classifier.sends_text_off_machine
              ? <span className="flag flag-warn">Sent to provider for classification</span>
              : <span className="flag flag-ok">Stays on this machine</span>}</dd>
            <dt>Authority</dt><dd>Labels only. Server policy decides.</dd>
          </dl>
        </div>
      </div>

      <div>
        <div className="pipe-head">
          <span className="sys-label">Pipeline — every response, in order</span>
          <span className="sys-label">
            {last ? `Last run · ${ago(last.at, now)} · ${last.kind} → ${last.outcome} · ${fmtMs(last.total_ms)}` : "No runs yet since the server started"}
          </span>
        </div>
        <ol className="pipe" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {p.pipeline.map((step, i) => {
            const st = step.step === "close" ? undefined : statusFor(step.step);
            const cls = st ? `ps-${st.status}` : "ps-none";
            return (
              <li className="pipe-step" key={step.step}>
                <span className="pipe-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="pipe-name">{TITLES[step.step] ?? step.step}</span>
                <p className="pipe-text">{step.text}</p>
                <span className={`pipe-status ${cls}`}>
                  {st ? <><span className="ps-dot" />{st.status === "skipped" ? "SKIPPED · not called" : `${st.status.toUpperCase()} · ${fmtMs(st.ms)}`}</>
                    : step.step === "close" && last ? <><span className="ps-dot" />{last.outcome}</>
                    : last ? <span className="ps-skipped" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span className="ps-dot" />not run</span> : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="proto-grid">
        <div className="sys-card">
          <h2 className="sys-h">Reviewed skills allowlist</h2>
          <table className="sys-table">
            <thead><tr><th>If the need is</th><th>Offer</th></tr></thead>
            <tbody>
              {p.needs.map((n) => (
                <tr key={n.id}><td>{n.label}</td><td className="m">{skillTitle(n.skill_id)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="sys-note">Fixed copy. The model returns a need id; it never writes advice. Reviewed by {p.skills_review.reviewed_by}, {verifiedOn(p.skills_review.reviewed_on)}. Not a clinical review.</p>
        </div>

        <div className="sys-card">
          <h2 className="sys-h">Human help — static configuration</h2>
          <table className="sys-table">
            <tbody>
              {[p.helplines.primary, p.helplines.emergency].map((h) => (
                <tr key={h.id}>
                  <td>
                    <a className="sys-number" href={`tel:${h.numbers[0].tel}`}>{h.numbers[0].display}</a>
                    <div style={{ color: "var(--sys-text-2)", fontSize: 13 }}>{h.name}{h.numbers[1] ? ` · also ${h.numbers[1].display}` : ""}</div>
                  </td>
                  <td className="m">verified {verifiedOn(h.verified_on)}<br />{new URL(h.source_url).host}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sys-note">
            {p.crisis_phrases.count} reviewed crisis phrases run locally before any model call. The list is deliberately over-inclusive — negations still route here (covered by tests). The model can escalate, never de-escalate.
          </p>
        </div>

        <div className="sys-card">
          <h2 className="sys-h">Storage &amp; disclosure</h2>
          <ul className="disclose">{p.disclosures.map((d) => <li key={d}>{d}</li>)}</ul>
          <table className="sys-table" style={{ marginTop: "var(--s-4)" }}>
            <tbody>
              {p.storage.map((s) => (
                <tr key={s.where}>
                  <td className="m" style={{ width: "38%" }}>{s.where}</td>
                  <td style={{ fontSize: 12.5, color: "var(--sys-text-2)" }}>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sys-card">
        <div className="pipe-head" style={{ marginBottom: "var(--s-3)" }}>
          <h2 className="sys-h" style={{ margin: 0 }}>Recent runs</h2>
          <span className="sys-label">Event codes only · in memory · cleared on restart · no response text</span>
        </div>
        {p.recent_runs.length === 0 ? <p className="empty">No runs yet. Complete a check-in and it appears here.</p> : (
          <div className="runs-wrap">
            <table className="runs">
              <thead><tr><th>When</th><th>Check-in</th><th>Kind</th><th>Steps</th><th>Outcome</th><th>Server time</th></tr></thead>
              <tbody>
                {p.recent_runs.map((r) => (
                  <tr key={`${r.at}-${r.checkin}-${r.kind}`}>
                    <td>{ago(r.at, now)}</td>
                    <td>{r.checkin}</td>
                    <td>{r.kind}</td>
                    <td>
                      <span className="chips">
                        {r.steps.map((s) => (
                          <span key={s.step} className={`chip ps-${s.status}`}><span className="ps-dot" />{s.step}</span>
                        ))}
                      </span>
                    </td>
                    <td className="o">{r.outcome}</td>
                    <td>{fmtMs(r.total_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
