import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Lock, ChevronDown, ListChecks, Timer, Wind, MessageCircle, Moon, Sun, Phone, Sparkles, CalendarDays } from "lucide-react";
import type { AppState, ClassifierInfo, RouteResult, StartResult } from "../lib/api";
import { cadenceLabel, clock, dayLabel } from "../lib/format";
import { Button } from "../components/Button";
import { Photo } from "../components/Photo";
import { Trace } from "../components/Trace";

type SkillR = Extract<RouteResult, { route: "skill" }>;
type ClarR = Extract<RouteResult, { route: "clarify" }>;

const STEPS = ["Prompt", "Safety", "Understand", "One step", "End"] as const;
function Journey({ now }: { now: (typeof STEPS)[number][] }) {
  const first = Math.min(...now.map((n) => STEPS.indexOf(n)));
  return (
    <div className="journey" aria-label="Check-in progress">
      {STEPS.map((s, i) => (
        <span key={s} data-s={now.includes(s) ? "now" : i < first ? "done" : "todo"} aria-current={now.includes(s) ? "step" : undefined}>{s}</span>
      ))}
    </div>
  );
}

function PanelHead({ title, onLeave }: { title: string; onLeave?: () => void }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="panel-head">
      {onLeave && <button className="circle-btn white" onClick={onLeave} aria-label="Leave check-in"><X size={20} /></button>}
      <h2>{title}</h2>
      <span className="date">{today}</span>
    </div>
  );
}

const enter = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: [0.2, 0, 0, 1] as const } };

/* ---------------- prompt + in-flight ---------------- */
export function PromptPanel({ start, submitting, error, initialText, onSubmit, onLeave }: {
  start: StartResult; submitting: boolean; error: string | null; initialText: string;
  onSubmit: (text: string) => void; onLeave: () => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (text.trim() && !submitting) onSubmit(text); };
  return (
    <motion.section className="panel focus" {...enter}>
      <PanelHead title="Check-in" onLeave={submitting ? undefined : onLeave} />
      <Journey now={submitting ? ["Safety", "Understand"] : ["Prompt"]} />
      <div>
        <p className="label" style={{ margin: "4px 0 8px" }}>Question</p>
        <h1 className="question">{start.prompt}</h1>
      </div>
      {submitting ? (
        <div className="checking" role="status" aria-live="polite">
          <span className="spinner" aria-hidden />
          <div><b>Checking your response</b><span>Safety check first, then one next step.</span></div>
        </div>
      ) : (
        <div>
          <p className="label" style={{ margin: "0 0 8px" }}>Your answer</p>
          <div className="answer">
            <label className="sr-only" htmlFor="response">Your answer</label>
            <textarea id="response" ref={ref} value={text} maxLength={start.max_chars} placeholder="A sentence or two is enough."
              autoComplete="off" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
            <div className="answer-foot"><span>{start.prompt_hint}</span><span className="tnum">{text.length}/{start.max_chars}</span></div>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <Button block onClick={submit} disabled={submitting || !text.trim()}>{submitting ? "Checking…" : "Submit"}</Button>
    </motion.section>
  );
}

/* ---------------- one next step (ref 2 journal entry) ---------------- */
export function ResultPanel({ result, classifier, via, closing, onDone }: {
  result: SkillR; classifier: ClassifierInfo; via: "classifier" | "clarify"; closing: boolean; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { skill } = result;
  const d = new Date();
  return (
    <motion.section className="panel focus wide" {...enter}>
      <PanelHead title={skill.id === "CLOSE_OK" ? "No step needed" : "One next step"} />
      <Journey now={["One step"]} />
      <article className="entry">
        <header className="entry-head">
          <div className="datebox"><span>{d.toLocaleDateString("en-US", { month: "short" })}</span><b>{d.getDate()}</b></div>
          <div><h2>{skill.title}</h2><p>{skill.summary}</p></div>
          {skill.minutes > 0 && <span className="tag">~{skill.minutes} min</span>}
        </header>
        <div className="entry-grid">
        <div className="grid-media">
          <div className="big"><Photo name={skill.id} /></div>
          <div className="tile lav"><span>Matched</span><b>{result.matched_label}</b></div>
          <div className="tile green"><span>Selected action</span><b>{result.selected_action}</b></div>
        </div>
        <div className="entry-side">
        <ol className="steps">
          {skill.steps.map((s, i) => (
            <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.06, duration: 0.3 }}>
              <i>{i + 1}</i><span>{s}</span>
            </motion.li>
          ))}
        </ol>
          <div className="side-done">
            <Button block onClick={onDone} disabled={closing}>{closing ? "Closing…" : "Done — close check-in"}</Button>
            <span className="privacy"><Lock size={15} aria-hidden /> Your response isn't stored by Still.</span>
          </div>
        </div>
        </div>
        <div className="reflect">
          <span className="reflect-ico" aria-hidden><Sparkles size={20} /></span>
          <div>
            <h3>Why this step</h3>
            <p>{via === "clarify" ? "You chose" : "Your response matched"} “{result.matched_label}”, so Still offered the one reviewed step for that. The advice comes from a fixed, reviewed list — Still didn't write it.</p>
          </div>
          <button className="chev" aria-expanded={open} aria-label="How Still decided" onClick={() => setOpen(!open)}><ChevronDown size={18} /></button>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
              <p className="label" style={{ margin: "0 0 8px" }}>How Still decided · {via === "clarify" ? "your choice → policy table" : `${classifier.provider} · ${classifier.model} → policy table`}</p>
              <Trace steps={result.trace} totalMs={result.total_ms} />
            </motion.div>
          )}
        </AnimatePresence>
      </article>
    </motion.section>
  );
}

/* ---------------- clarify ---------------- */
const NEED_ICON: Record<string, { icon: typeof Sun; bg: string }> = {
  too_many_tasks: { icon: ListChecks, bg: "var(--lav)" },
  cant_get_started: { icon: Timer, bg: "var(--green-1)" },
  wound_up: { icon: Wind, bg: "var(--peach)" },
  feeling_cut_off: { icon: MessageCircle, bg: "#F9D7D3" },
  sleep_or_worn_out: { icon: Moon, bg: "#E4E1F5" },
  doing_ok: { icon: Sun, bg: "#EEF6CF" },
};

export function ClarifyPanel({ result, busy, onChoose, onClose }: {
  result: ClarR; busy: boolean; onChoose: (c: string) => void; onClose: () => void;
}) {
  return (
    <motion.section className="panel focus" {...enter}>
      <PanelHead title="One question" />
      <Journey now={["Understand"]} />
      <div>
        <h1 className="question">Which feels closest?</h1>
        <p className="lead" style={{ marginTop: 8 }}>
          {result.reason === "classifier_failed" ? "Still couldn't read that reliably, so it's asking instead of guessing." : "Still wasn't sure which step fits, so it's asking instead of guessing."}
        </p>
      </div>
      <div className="options">
        {result.options.map((o) => {
          const I = NEED_ICON[o.need_id] ?? { icon: Sun, bg: "var(--soft)" };
          return (
            <button key={o.need_id} className="opt" disabled={busy} onClick={() => onChoose(o.need_id)}>
              <span className="opt-ico" style={{ background: I.bg }} aria-hidden><I.icon size={20} /></span>{o.label}
            </button>
          );
        })}
        <button className="opt person" disabled={busy} onClick={() => onChoose("talk_to_person")}>
          <span className="opt-ico" aria-hidden><Phone size={20} /></span>I'd rather talk to a person
        </button>
      </div>
      <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onClose} disabled={busy}>Close without choosing</button>
    </motion.section>
  );
}

/* ---------------- done (ref 4 onboarding) ---------------- */
export function DonePanel({ state, step, onHome }: { state: AppState; step: { id: string; title: string } | null; onHome: () => void }) {
  const s = state.schedule;
  return (
    <motion.section className="done" {...enter}>
      <h1 className="title">That's the<br />check&#8209;in. <span className="mark">Done.</span></h1>
      <p className="lead">{step ? `You left with one step: ${step.title}.` : "Closed without a step."} Still won't follow up until your next check‑in.</p>
      <div className="next-chip">
        <div className="thumb">{step ? <Photo name={step.id} /> : <Photo name="shelf" />}</div>
        <div><span>Next check&#8209;in</span><b className="tnum">{s?.next_due_at ? `${dayLabel(s.next_due_at, state.now)} · ${clock(s.next_due_at)}` : "Not scheduled"}</b></div>
        {s && <span className="tag"><CalendarDays size={14} style={{ marginRight: 6 }} />{cadenceLabel(s.cadence)}</span>}
      </div>
      <div className="done-bar">
        <span className="privacy"><Lock size={15} aria-hidden /> Your response isn't stored by Still.</span>
        <Button onClick={onHome}>Back to Today</Button>
      </div>
    </motion.section>
  );
}
