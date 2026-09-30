import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Action } from "../lib/api";
import { Button } from "./Button";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seconds elapsed since `startedAt`, ticking. */
function useElapsed(startedAt: number, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);
  return Math.max(0, (now - startedAt) / 1000);
}

function Ring({ progress, children }: { progress: number; children: React.ReactNode }) {
  const R = 70, C = 2 * Math.PI * R;
  return (
    <div className="ring">
      <svg viewBox="0 0 170 170" aria-hidden>
        <circle cx="85" cy="85" r={R} fill="none" stroke="#2A2A2A" strokeWidth="12" />
        <circle cx="85" cy="85" r={R} fill="none" stroke="var(--lime)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))} style={{ transition: "stroke-dashoffset 200ms linear" }} />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/**
 * Runs one allowlisted executor in the browser. The server already recorded the start (POST /act);
 * durations and phases come from reviewed config. Calls onFinish exactly once.
 */
export function ActionRunner({ action, startedAt, onFinish }: {
  action: Action; startedAt: number; onFinish: (result: "completed" | "stopped") => void;
}) {
  const total = action.duration_s ?? 0;
  const [finished, setFinished] = useState(false);
  const elapsed = useElapsed(startedAt, !finished);
  const done = useRef(false);
  const finish = (r: "completed" | "stopped") => { if (done.current) return; done.current = true; setFinished(true); onFinish(r); };
  useEffect(() => { if (elapsed >= total && total > 0) finish("completed"); }, [elapsed, total]);
  const t = Math.min(elapsed, total);
  const left = Math.max(0, total - t);

  let center: React.ReactNode;
  let title: string;
  let sub: string;
  if (action.executor === "BREATHING_GUIDE" && action.phases) {
    const round = action.phases.reduce((n, p) => n + p.seconds, 0);
    const within = t % round;
    let acc = 0, phase = action.phases[0], phaseLeft = phase.seconds;
    for (const p of action.phases) { if (within < acc + p.seconds) { phase = p; phaseLeft = acc + p.seconds - within; break; } acc += p.seconds; }
    const inhale = phase === action.phases[0];
    center = (
      <>
        <motion.span className="breath" aria-hidden animate={{ scale: inhale ? 1 : 0.72 }} transition={{ duration: phase.seconds, ease: "easeInOut" }} />
        <span className="ring-time" style={{ fontSize: "1.3rem", position: "relative" }}>{phase.label}</span>
        <span className="ring-sub" style={{ position: "relative" }}>{Math.ceil(phaseLeft)}</span>
      </>
    );
    title = "Guided breathing";
    sub = `Round ${Math.min(action.rounds ?? 1, Math.floor(t / round) + 1)} of ${action.rounds} · ${mmss(left)} left`;
  } else if (action.executor === "GUIDED_RESET" && action.cues) {
    const per = total / action.cues.length;
    const i = Math.min(action.cues.length - 1, Math.floor(t / per));
    center = <><span className="ring-time tnum">{mmss(left)}</span><span className="ring-sub">cue {i + 1} of {action.cues.length}</span></>;
    title = action.cues[i];
    sub = "Follow the cue. The next one appears on its own.";
  } else {
    center = <><span className="ring-time tnum">{mmss(left)}</span><span className="ring-sub">focus</span></>;
    title = action.target ? `Focus on ${action.target}` : "Focus";
    sub = "Only this, until the timer ends.";
  }

  return (
    <div className="runner" role="timer" aria-live="polite">
      <Ring progress={total ? t / total : 1}>{center}</Ring>
      <div className="runner-body">
        <span className="runner-kicker">{action.label} · running</span>
        <b className="runner-title">{title}</b>
        <span className="runner-sub">{sub}</span>
        <div className="runner-actions">
          <button className="btn btn-light btn-plain" onClick={() => finish("completed")}>I'm done</button>
          <button className="link-btn runner-stop" onClick={() => finish("stopped")}>Stop</button>
        </div>
      </div>
    </div>
  );
}
