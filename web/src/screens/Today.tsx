import { motion } from "motion/react";
import { CalendarDays, Clock3, Globe2, ArrowUpRight, Timer } from "lucide-react";
import type { AppState } from "../lib/api";
import { cadenceLabel, clock, countdown, dayLabel, timeParts } from "../lib/format";
import { useNow } from "../lib/useLive";
import { loadSession } from "../lib/session";
import { Button } from "../components/Button";
import { Photo } from "../components/Photo";
import { TAB_HREF } from "../components/Shell";

const rise = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: [0.2, 0, 0, 1] as const } };

export function Today({ state, notice, busy, onCheckInNow, onBegin, onSkip, onResume, onFinish, onTakeOver, onEnd }: {
  state: AppState; notice: string | null; busy: boolean;
  onCheckInNow: () => void; onBegin: (id: string) => void; onSkip: (id: string) => void; onResume: () => void; onFinish: () => void;
  onTakeOver: (id: string) => void; onEnd: (id: string) => void;
}) {
  const now = useNow(state.now);
  const s = state.schedule;
  const open = state.open_checkin;

  const session = open ? loadSession() : null;
  const mine = !!open && session?.id === open.id;
  // An unanswered check-in (ready, or started earlier / in another tab) always looks the same:
  // the green card. Begin starts it, or picks it back up with a fresh session.
  const unanswered = open && (open.status === "ready" || open.status === "in_progress");
  // Answered but not closed (e.g. the tab was closed on the result): close it quietly from here.
  const answeredOpen = open && (open.status === "offered" || open.status === "clarifying");

  // ---- ready: the green card (ref 4) ----
  if (unanswered) {
    const begin = open.status === "ready" ? () => onBegin(open.id) : mine ? onResume : () => onTakeOver(open.id);
    const later = open.status === "ready" ? () => onSkip(open.id) : () => onEnd(open.id);
    return (
      <section className="today">
        <motion.h1 className="hero" {...rise}>
          <span className="hero-line">Your check&#8209;in</span>
          <span className="hero-line">is <span className="mark">ready</span></span>
        </motion.h1>
        <motion.div className="ready-wrap" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: 0.05 }}>
          <div className="ready-card">
            <div className="ready-top">
              <span>{open.source === "scheduled" ? `Scheduled · ${clock(open.due_at)}` : `Started · ${clock(open.due_at)}`}</span>
              <span className="round" aria-hidden><Timer size={18} /></span>
            </div>
            <div className="app-tile" aria-hidden><i /></div>
            <h2>Daily check&#8209;in</h2>
            <span className="where"><Clock3 size={15} /> about a minute</span>
            <div className="ready-rule" />
            <div className="bullets"><span>One question</span><span>One step</span><span>Then it ends</span></div>
            <Button onClick={begin} disabled={busy} style={{ marginTop: 8 }}>Begin check&#8209;in</Button>
          </div>
        </motion.div>
        <button className="link-btn" onClick={later} disabled={busy}>Skip this one</button>
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>
    );
  }

  // ---- first run: no schedule yet ----
  if (!s) {
    return (
      <section className="today">
        <motion.h1 className="hero" {...rise}>
          <span className="hero-line">When should</span>
          <span className="hero-line">still <span className="hero-pill"><Photo name="shelf" /></span> check in?</span>
        </motion.h1>
        <div className="stamp-row"><span className="stamp">one question a day</span></div>
        <p className="lead" style={{ textAlign: "center", maxWidth: 520 }}>
          Pick a time. When it's due, a short check&#8209;in appears here — one question, one small step, then it ends.
        </p>
        <a className="btn btn-dark" href={TAB_HREF.schedule}><span>Set a check&#8209;in time</span><span className="ico" aria-hidden><ArrowUpRight size={20} /></span></a>
      </section>
    );
  }

  // ---- waiting: next check-in (dark card, ref 3) ----
  const due = s.next_due_at;
  const t = due ? timeParts(due) : null;
  const period = 24 * 3600_000;
  const progress = due ? Math.min(1, Math.max(0, 1 - (due - now) / period)) : 0;
  const R = 70, C = 2 * Math.PI * R;
  return (
    <section className="today">
      <motion.h1 className="hero" {...rise}>
        <span className="hero-line">Your next</span>
        <span className="hero-line">check&#8209;in <span className="hero-pill"><Photo name="shelf" /></span></span>
      </motion.h1>
      {due && <div className="stamp-row"><span className="stamp tnum">{countdown(due, now)}</span></div>}

      <motion.div className="next-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: 0.06 }}>
        <h3>Next check&#8209;in</h3>
        <div className="ring" role="img" aria-label={due ? `${dayLabel(due, now)} at ${clock(due)}` : "Paused"}>
          <svg viewBox="0 0 170 170" aria-hidden>
            <circle cx="85" cy="85" r={R} fill="none" stroke="#2A2A2A" strokeWidth="14" />
            <motion.circle cx="85" cy="85" r={R} fill="none" stroke="var(--lime)" strokeWidth="14" strokeLinecap="round"
              strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - progress) }}
              transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }} />
          </svg>
          <div className="ring-center">
            <span className="ring-time tnum">{t ? t.hm : "—"}</span>
            <span className="ring-sub">{t ? t.ampm : "paused"}</span>
          </div>
        </div>
        <div className="vdiv" />
        <div className="stats">
          <div className="stat"><span className="stat-ico"><CalendarDays size={18} /></span><div><b>{due ? dayLabel(due, now) : "Paused"}</b><span>Day</span></div></div>
          <div className="stat"><span className="stat-ico"><Timer size={18} /></span><div><b className="countdown-live tnum">{due ? countdown(due, now) : "—"}</b><span>Until it's ready</span></div></div>
          <div className="stat"><span className="stat-ico"><Globe2 size={18} /></span><div><b>{cadenceLabel(s.cadence)}</b><span>{s.timezone}</span></div></div>
        </div>
      </motion.div>

      <div className="today-actions">
        <Button onClick={onCheckInNow} disabled={busy}>Check in now</Button>
        <a className="btn btn-soft" href={TAB_HREF.schedule}>Edit schedule</a>
      </div>
      <p className="fine">A due check&#8209;in appears here and in the menu. Still doesn't send notifications.</p>
      {answeredOpen && (
        <p className="notice" role="status">
          Your last check&#8209;in is still open.{" "}
          <button className="link-btn" onClick={() => (mine ? onFinish() : onEnd(open.id))} disabled={busy}>Close it</button>
        </p>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}

/** Right column on Today (ref 1: floating card + "learn more"). */
export function TodaySide({ state }: { state: AppState }) {
  const l = state.last_checkin;
  const text: Record<string, string> = {
    completed: l?.skill_title ? `Closed after one step: ${l.skill_title}.` : "Closed without a step.",
    help_shown: "Ended with human support.",
    skipped: "Skipped.",
    expired: "Not started — it expired.",
    abandoned: "Ended before an answer.",
  };
  return (
    <>
      <div className="float-card">
        <span className="float-pill">Last check&#8209;in</span>
        <p className="small" style={{ padding: "0 6px" }}>
          {l ? <>{text[l.status] ?? "Closed."}{l.closed_at && <><br /><span className="muted">{dayLabel(l.closed_at, state.now)} · {clock(l.closed_at)}</span></>}</> : "None yet. Your first one shows up here."}
        </p>
        <div className="float-photo"><Photo name="student" /></div>
      </div>
      <div className="end-note">
        <h3>It ends after<br />one step.</h3>
        <a className="btn btn-outline" href={TAB_HREF.how}><span>How it works</span><span className="ico" aria-hidden><ArrowUpRight size={20} /></span></a>
      </div>
    </>
  );
}

