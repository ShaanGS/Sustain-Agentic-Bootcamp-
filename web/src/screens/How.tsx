import { useEffect, useState } from "react";
import { Cpu, ShieldCheck, ListFilter } from "lucide-react";
import { api, type Protocol, type TraceStep } from "../lib/api";
import { ago, fmtMs, verifiedOn } from "../lib/format";
import { useNow } from "../lib/useLive";
import { Photo } from "../components/Photo";

const TITLES: Record<string, string> = {
  session: "Session", crisis_phrase: "Crisis phrase", classifier: "Classify", validate: "Validate", policy: "Policy", close: "Close",
};

/** How it works — the protocol on one screen, from GET /api/protocol, refreshing during a demo. */
export function How({ protocol }: { protocol: Protocol | null }) {
  const now = useNow(undefined, 1000);
  if (!protocol) return <p className="empty">Loading…</p>;
  const p = protocol;
  const last = p.recent_runs[0];
  const stepOf = (k: string): TraceStep | undefined => last?.steps.find((s) => s.step === k);
  const skillTitle = (id: string) => p.skills.find((s) => s.id === id)?.title ?? id;

  return (
    <section className="how">
      <div className="how-head">
        <h1 className="how-title">One question.<br />One step. Then it <span className="mark">stops.</span></h1>
        <p className="lead">Every response goes through the same six steps, in order. The model only labels; a fixed server table decides. The last run below is live.</p>
      </div>

      <div className="net" aria-label="Pipeline">
        <div className="net-track" aria-hidden />
        <ol className="net-nodes" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {p.pipeline.map((step, i) => {
            const st = step.step === "close" ? undefined : stepOf(step.step);
            const s = st?.status ?? (last && step.step !== "close" ? "notrun" : "none");
            const label = st ? (st.status === "skipped" ? "skipped · not called" : `${st.status} · ${fmtMs(st.ms)}`)
              : step.step === "close" && last ? last.outcome : last ? "not run" : "—";
            return (
              <li className="node" key={step.step} data-s={s === "fail" ? "hit" : s}>
                <div className="node-circle"><span className="node-n">{String(i + 1).padStart(2, "0")}</span>{TITLES[step.step]}</div>
                <div><span className="node-status">{label}</span></div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="small" style={{ marginTop: -20 }}>
        {last ? `Last run ${ago(last.at, now)} · ${last.kind} → ${last.outcome} · ${fmtMs(last.total_ms)} on the server` : "No runs since the server started. Complete a check-in and watch this update."}
      </p>

      <div className="statbar">
        <div><span className="ico" style={{ background: "var(--lav)" }}><Cpu size={20} /></span><span>Classifier</span><b>{p.classifier.provider} · {p.classifier.model}</b></div>
        <div><span className="ico" style={{ background: "var(--green-1)" }}><ShieldCheck size={20} /></span><span>Response text</span>
          <b>{p.classifier.sends_text_off_machine ? "Sent to provider to classify" : "Stays on this machine"}</b></div>
        <div><span className="ico" style={{ background: "var(--peach)" }}><ListFilter size={20} /></span><span>Crisis phrases</span><b>{p.crisis_phrases.count} reviewed · checked first, locally</b></div>
      </div>

      <div className="how-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="dcard">
          <h3>The rules, in order</h3>
          <ol className="disclose" style={{ listStyle: "none" }}>
            {p.pipeline.map((s, i) => <li key={s.step}><b>{i + 1}. {TITLES[s.step]}.</b> {s.text}</li>)}
          </ol>
        </div>
        <div className="dcard">
          <h3>Reviewed skills — the only advice Still can give</h3>
          {p.needs.map((n) => (
            <div className="skill-row" key={n.id}>
              <div className="thumb"><Photo name={n.skill_id} /></div>
              <div><b>{skillTitle(n.skill_id)}</b><span>when the need is “{n.label}”</span></div>
            </div>
          ))}
          <p className="note">Fixed copy, reviewed by {p.skills_review.reviewed_by} on {verifiedOn(p.skills_review.reviewed_on)}. Not a clinical review.</p>
        </div>
        <div className="dcard">
          <h3>Human help — static configuration</h3>
          {[p.helplines.primary, p.helplines.emergency].map((h) => (
            <div className="dline" key={h.id}>
              <div><span className="dnum">{h.numbers[0].display}</span><em>{h.name}{h.numbers[1] ? ` · also ${h.numbers[1].display}` : ""}</em></div>
              <small>verified {verifiedOn(h.verified_on)}<br />{new URL(h.source_url).host}</small>
            </div>
          ))}
          <p className="note">The crisis phrase list is deliberately over-inclusive — negations still route here (covered by tests). The model can escalate to help, never de-escalate.</p>
        </div>
        <div className="dcard">
          <h3>What is stored, and where</h3>
          <ul className="disclose">{p.disclosures.map((d) => <li key={d}>{d}</li>)}</ul>
          <div className="store">{p.storage.map((s) => <div key={s.where}><b>{s.where}</b><span>{s.what}</span></div>)}</div>
        </div>
      </div>

      <div className="runs-card">
        <div className="runs-head"><h3>Recent runs</h3><span>Event codes only · in memory · cleared on restart · never response text</span></div>
        {p.recent_runs.length === 0 ? <p className="empty">No runs yet.</p> : (
          <div className="runs-wrap">
            <table className="runs">
              <thead><tr><th>When</th><th>Check-in</th><th>Kind</th><th>Steps</th><th>Outcome</th><th>Server time</th></tr></thead>
              <tbody>
                {p.recent_runs.map((r) => (
                  <tr key={`${r.at}-${r.checkin}-${r.kind}`}>
                    <td>{ago(r.at, now)}</td><td>{r.checkin}</td><td>{r.kind}</td>
                    <td><span className="rchips">{r.steps.map((s) => <span key={s.step} className={`rchip ${s.status}`}><i />{s.step}</span>)}</span></td>
                    <td className="o">{r.outcome}</td><td>{fmtMs(r.total_ms)}</td>
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

/** Polls /api/protocol. Also supplies the skills list for the carousel. */
export function useProtocol(intervalMs: number) {
  const [p, setP] = useState<Protocol | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.protocol().then((x) => alive && setP(x)).catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return p;
}
