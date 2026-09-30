import { useEffect, useState } from "react";
import { Cpu, ShieldCheck, ListFilter } from "lucide-react";
import { api, type Protocol, type TraceStep } from "../lib/api";
import { ago, fmtMs, verifiedOn } from "../lib/format";
import { useNow } from "../lib/useLive";
import { Photo } from "../components/Photo";

const TITLES: Record<string, string> = {
  trigger: "Trigger", observe: "Observe", safety: "Safety", model: "Model", understand: "Understand", decide: "Decide", act: "Act", end: "End",
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
        <h1 className="how-title">Observe. Decide.<br />Act once. Then it <span className="mark">stops.</span></h1>
        <p className="lead">Every check-in runs the same bounded loop. Safety comes first; the model only assesses and understands; a fixed server table decides; one allowlisted action runs. The last run below is live.</p>
      </div>

      <div className="net" aria-label="Pipeline">
        <div className="net-track" aria-hidden />
        <ol className="net-nodes" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {p.pipeline.map((step, i) => {
            const st = stepOf(step.step);
            const s = st ? (st.status === "fail" ? "hit" : st.status === "pending" ? "pass" : st.status) : last ? "notrun" : "none";
            return (
              <li className="node" key={step.step} data-s={s}>
                <div className="node-circle"><span className="node-n">{String(i + 1).padStart(2, "0")}</span>{TITLES[step.step]}</div>
                <div><span className="node-status">{st ? `${st.label}${st.ms !== undefined ? ` · ${fmtMs(st.ms)}` : ""}` : last ? "—" : ""}</span></div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="small" style={{ marginTop: -20 }}>
        {last ? `Latest check-in ${last.checkin} · ${ago(last.at, now)} · ${last.outcome} · ${fmtMs(last.total_ms)} to decide on the server` : "No runs since the server started. Complete a check-in and watch this update."}
      </p>

      <div className="statbar">
        <div><span className="ico" style={{ background: "var(--lav)" }}><Cpu size={20} /></span><span>Classifier</span><b>{p.classifier.provider} · {p.classifier.model}</b></div>
        <div><span className="ico" style={{ background: "var(--green-1)" }}><ShieldCheck size={20} /></span><span>Response text</span>
          <b>{p.classifier.sends_text_off_machine ? "Sent to provider to classify" : "Stays on this machine"}</b></div>
        <div><span className="ico" style={{ background: "var(--peach)" }}><ListFilter size={20} /></span><span>Safety backstop</span><b>{p.crisis_phrases.count} reviewed phrases · model skipped on a match</b></div>
      </div>

      <div className="how-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="dcard">
          <h3>The rules, in order</h3>
          <ol className="disclose" style={{ listStyle: "none" }}>
            {p.pipeline.map((s, i) => <li key={s.step}><b>{i + 1}. {TITLES[s.step]}.</b> {s.text}</li>)}
          </ol>
        </div>
        <div className="dcard">
          <h3>Skills → executors — the only things Still can do</h3>
          {p.needs.map((n) => {
            const ex = p.executors.find((e) => e.skill_id === n.skill_id);
            return (
              <div className="skill-row" key={n.id}>
                <div className="thumb"><Photo name={n.skill_id} /></div>
                <div><b>{skillTitle(n.skill_id)} → {ex?.type ?? "—"}</b><span>when the need is “{n.label}” · {ex?.label}</span></div>
              </div>
            );
          })}
          <p className="note">Fixed copy and server-controlled durations, reviewed by {p.skills_review.reviewed_by} on {verifiedOn(p.skills_review.reviewed_on)}. Not a clinical review. No executor can reach the network, send messages, write files or call other tools.</p>
        </div>
        <div className="dcard">
          <h3>Human help — static configuration</h3>
          {[p.helplines.primary, p.helplines.emergency].map((h) => (
            <div className="dline" key={h.id}>
              <div><span className="dnum">{h.numbers[0].display}</span><em>{h.name}{h.numbers[1] ? ` · also ${h.numbers[1].display}` : ""}</em></div>
              <small>verified {verifiedOn(h.verified_on)}<br />{new URL(h.source_url).host}</small>
            </div>
          ))}
          <p className="note">{p.crisis_phrases.self_harm} self-harm and {p.crisis_phrases.emergency} emergency phrases (poisoning, overdose — shown with 112 first). Deliberately over-inclusive; not a medical detector. The model safety layer covers other phrasings and can also be wrong, so everything fails closed. A clarification re-checks the original response and can never downgrade it.</p>
        </div>
        <div className="dcard">
          <h3>What is stored, and where</h3>
          <ul className="disclose">{p.disclosures.map((d) => <li key={d}>{d}</li>)}</ul>
          <div className="store">{p.storage.map((s) => <div key={s.where}><b>{s.where}</b><span>{s.what}</span></div>)}</div>
        </div>
      </div>

      <div className="runs-card">
        <div className="runs-head"><h3>Recent runs</h3><span>Event codes only · last 20 · never response text</span></div>
        {p.recent_runs.length === 0 ? <p className="empty">No runs yet.</p> : (
          <div className="runs-wrap">
            <table className="runs">
              <thead><tr><th>When</th><th>Check-in</th><th>Agent trace</th><th>Outcome</th><th>Decide time</th></tr></thead>
              <tbody>
                {p.recent_runs.map((r) => (
                  <tr key={`${r.at}-${r.checkin}`}>
                    <td>{ago(r.at, now)}</td><td>{r.checkin}</td>
                    <td><span className="rchips">{r.steps.map((s) => <span key={s.step} className={`rchip ${s.status}`} title={`${s.label} — ${s.detail}`}><i />{s.step}</span>)}</span></td>
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
