import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Lock, ChevronDown, ListChecks, Timer, Wind, MessageCircle, Moon, Sun, Phone, Sparkles, CalendarDays, Target, Check, Copy } from "lucide-react";
import type { Action, AppState, ClassifierInfo, RouteResult, StartResult } from "../lib/api";
import { cadenceLabel, clock, dayLabel } from "../lib/format";
import { Button } from "../components/Button";
import { Photo } from "../components/Photo";
import { Trace } from "../components/Trace";
import { ActionRunner } from "../components/Executor";

type SkillR = Extract<RouteResult, { route: "skill" }>;
type ClarR = Extract<RouteResult, { route: "clarify" }>;

const STEPS = ["Observe", "Safety", "Understand", "Decide", "Act", "End"] as const;
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
export function PromptPanel({ start, submitting, error, scope, initialText, onSubmit, onLeave }: {
  start: StartResult; submitting: boolean; error: string | null; scope: boolean; initialText: string;
  onSubmit: (text: string) => void; onLeave: () => void;
}) {
  const [text, setText] = useState(initialText);
  useEffect(() => { if (scope) setText(""); }, [scope]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (text.trim() && !submitting) onSubmit(text); };
  return (
    <motion.section className="panel focus" {...enter}>
      <PanelHead title="Check-in" onLeave={submitting ? undefined : onLeave} />
      <Journey now={submitting ? ["Safety", "Understand", "Decide"] : ["Observe"]} />
      <div>
        <p className="label" style={{ margin: "4px 0 8px" }}>Question</p>
        <h1 className="question">{start.prompt}</h1>
      </div>
      {submitting ? (
        <div className="checking" role="status" aria-live="polite">
          <span className="spinner" aria-hidden />
          <div><b>Checking your response</b><span>Safety first — then Still understands what's going on, decides one step and gets it ready.</span></div>
        </div>
      ) : (
        <div>
          <p className="label" style={{ margin: "0 0 8px" }}>Your answer</p>
          <div className="answer">
            <label className="sr-only" htmlFor="response">Your answer</label>
            <textarea id="response" ref={ref} value={text} maxLength={start.max_chars} placeholder="A sentence or two is enough."
              autoComplete="off" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits; Shift+Enter adds a new line. Ignore Enter while an IME is composing text.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              }} />
            <div className="answer-foot"><span>{start.prompt_hint}</span><span className="tnum">Enter to submit · Shift+Enter for a new line · {text.length}/{start.max_chars}</span></div>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {scope && (
        <div className="scope-note" role="status">
          <b>That's not something Still does.</b>
          <span>Still read your message as a request to build or change something, not a check-in — so it took no action. It has no code, system or database tools, only five small check-in actions. Tell it how you're actually doing, or close.</span>
        </div>
      )}
      <Button block onClick={submit} disabled={submitting || !text.trim()}>{submitting ? "Checking…" : "Submit"}</Button>
    </motion.section>
  );
}

/* ---------------- one next step (ref 2 journal entry) + the action ---------------- */
export type RunState = { phase: "idle" | "starting" | "running" | "done"; startedAt?: number; result?: string };

const RESULT_TEXT: Record<string, string> = {
  completed: "completed", stopped: "stopped early — that still counts", copied: "copied — Still hasn't sent anything", acknowledged: "noted",
};

/** SAFETY → UNDERSTAND → DECIDE → ACT → END, as observable labels from real state (not reasoning). */
function AgentTrail({ result, run }: { result: SkillR; run: RunState }) {
  const safety = result.trace.find((t) => t.step === "safety")?.label ?? "Clear";
  const act = run.phase === "running" ? "running" : run.phase === "done" ? RESULT_TEXT[run.result ?? ""]?.split(" ")[0] ?? "done" : "ready";
  const items: [string, string, "done" | "now" | "todo"][] = [
    ["Safety", `✓ ${safety}`, "done"],
    ["Understand", `✓ ${result.understood}`, "done"],
    ["Decide", `→ ${result.skill.title}`, "done"],
    ["Act", `${result.action.label} · ${act}`, run.phase === "done" ? "done" : "now"],
    ["End", run.phase === "done" ? "ready to close" : "after the action", run.phase === "done" ? "now" : "todo"],
  ];
  return (
    <div className="trail" aria-label="What Still did">
      {items.map(([k, v, st]) => <span key={k} data-s={st}><b>{k}</b>{v}</span>)}
    </div>
  );
}

function ActionPanel({ action, skill, run, closing, onStart, onFinish, onClose }: {
  action: Action; skill: SkillR["skill"]; run: RunState; closing: boolean;
  onStart: () => void; onFinish: (r: "completed" | "stopped") => void; onClose: () => void;
}) {
  if (run.phase === "running" && run.startedAt) return <ActionRunner action={action} startedAt={run.startedAt} onFinish={onFinish} />;
  if (run.phase === "done") {
    return (
      <>
        <div className="act-done" role="status">
          <b><Check size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{action.label} — {RESULT_TEXT[run.result ?? ""] ?? "done"}</b>
          <span>{action.executor === "COPY_MESSAGE" ? "Paste it to one person you trust. Sending is up to you." : "That was the one step. Still stops here."}</span>
        </div>
        <Button block onClick={onClose} disabled={closing}>{closing ? "Closing…" : "Done — close check-in"}</Button>
      </>
    );
  }
  return (
    <>
      <p className="next-step"><small>One next step</small>{skill.next_step}</p>
      {action.target && <span className="target"><Target size={15} /> Focus on {action.target}</span>}
      {action.executor === "COPY_MESSAGE" && action.message && <div className="msg-box">“{action.message}”</div>}
      {skill.steps.length > 0 && action.executor !== "COPY_MESSAGE" && (
        <ol className="steps">
          {skill.steps.map((s, i) => (
            <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.06, duration: 0.3 }}>
              <i>{i + 1}</i><span>{s}</span>
            </motion.li>
          ))}
        </ol>
      )}
      <Button block onClick={onStart} disabled={run.phase === "starting" || closing}>
        {action.executor === "COPY_MESSAGE" ? <><Copy size={16} style={{ verticalAlign: -3, marginRight: 8 }} />{action.cta}</> : action.cta}
      </Button>
      {action.executor !== "ACKNOWLEDGE" && <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onClose} disabled={closing}>Skip — close check-in</button>}
    </>
  );
}

export function ResultPanel({ result, classifier, via, run, closing, onStart, onFinish, onDone }: {
  result: SkillR; classifier: ClassifierInfo; via: "classifier" | "clarify"; run: RunState; closing: boolean;
  onStart: () => void; onFinish: (r: "completed" | "stopped") => void; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { skill, action, context } = result;
  const d = new Date();
  const mentioned = context?.situation ? `You mentioned ${context.situation}.` : skill.summary;
  return (
    <motion.section className="panel focus wide" {...enter}>
      <PanelHead title={skill.id === "CLOSE_OK" ? "No step needed" : "One next step"} />
      <AgentTrail result={result} run={run} />
      <article className="entry">
        <header className="entry-head">
          <div className="datebox"><span>{d.toLocaleDateString("en-US", { month: "short" })}</span><b>{d.getDate()}</b></div>
          <div><h2>{skill.title}</h2><p>{mentioned}</p></div>
          {skill.minutes > 0 && <span className="tag">~{skill.minutes} min</span>}
        </header>
        <div className="entry-grid">
          <div className="grid-media">
            <div className="big"><Photo name={skill.id} /></div>
            <div className="tile lav"><span>Understood</span><b>{result.understood}</b></div>
            <div className="tile green"><span>Action</span><b>{action.label}</b></div>
          </div>
          <div className="entry-side">
            <ActionPanel action={action} skill={skill} run={run} closing={closing} onStart={onStart} onFinish={onFinish} onClose={onDone} />
            <span className="privacy"><Lock size={15} aria-hidden /> Your response isn't stored by Still.</span>
          </div>
        </div>
        <div className="reflect">
          <span className="reflect-ico" aria-hidden><Sparkles size={20} /></span>
          <div>
            <h3>Why this step</h3>
            <p>{via === "clarify" ? `You chose “${result.understood}”` : `Still identified “${result.understood}”`} and selected the approved {skill.title} skill for that situation. The steps and the {action.label} come from a fixed, reviewed list — Still didn't write them.</p>
          </div>
          <button className="chev" aria-expanded={open} aria-label="How Still decided" onClick={() => setOpen(!open)}><ChevronDown size={18} /></button>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
              <p className="label" style={{ margin: "0 0 8px" }}>Agent trace · {via === "clarify" ? "your choice → policy table" : `${classifier.provider} · ${classifier.model} → policy table`}</p>
              <Trace totalMs={result.total_ms} steps={result.trace.map((s) => s.step !== "act" || run.phase === "idle" || run.phase === "starting" ? s
                : { ...s, status: "pass" as const, label: `${action.label} · ${run.phase === "running" ? "running" : run.result}`, detail: `${action.executor} started by the student — recorded on the server` })} />
            </motion.div>
          )}
        </AnimatePresence>
      </article>
    </motion.section>
  );
}

/* ---------------- clarify ---------------- */
const NEED_ICON: Record<string, { icon: typeof Sun; bg: string }> = {
  COMPETING_TASKS: { icon: ListChecks, bg: "var(--lav)" },
  DIFFICULTY_STARTING: { icon: Timer, bg: "var(--green-1)" },
  ACUTE_TENSION: { icon: Wind, bg: "var(--peach)" },
  FEELING_ISOLATED: { icon: MessageCircle, bg: "#F9D7D3" },
  SLEEP_OR_EXHAUSTION: { icon: Moon, bg: "#E4E1F5" },
  DOING_OK: { icon: Sun, bg: "#EEF6CF" },
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
export function DonePanel({ state, step, onHome }: { state: AppState; step: { id: string; title: string; action?: string; result?: string | null } | null; onHome: () => void }) {
  const s = state.schedule;
  return (
    <motion.section className="done" {...enter}>
      <h1 className="title">That's the<br />check&#8209;in. <span className="mark">Done.</span></h1>
      <p className="lead">{step ? `One step: ${step.title}${step.action ? ` · ${step.action} ${step.result && step.result !== "not_started" ? (RESULT_TEXT[step.result] ?? step.result).split(" —")[0] : "not started"}` : ""}.` : "Closed without a step."} Still won't follow up until your next check‑in.</p>
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
