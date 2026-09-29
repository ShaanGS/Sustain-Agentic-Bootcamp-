import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { AppState, Schedule } from "../lib/api";
import { cadenceLabel, clock, countdown, dayLabel, timeParts } from "../lib/format";
import { useNow } from "../lib/useLive";
import { Button } from "../components/Button";
import { ScheduleEditor } from "./ScheduleEditor";
import { loadSession } from "../lib/session";

const fade = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.3, ease: [0.2, 0, 0, 1] as const } };

export function Home({ state, notice, busy, onSaved, onCheckInNow, onBegin, onSkip, onResume, onFinish }: {
  state: AppState;
  notice: string | null;
  busy: boolean;
  onSaved: (s: Schedule) => void;
  onCheckInNow: () => void;
  onBegin: (id: string) => void;
  onSkip: (id: string) => void;
  onResume: () => void;
  onFinish: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const now = useNow(state.now);
  const s = state.schedule;
  const open = state.open_checkin;
  const session = open ? loadSession() : null;
  const haveSession = !!(open && session && session.id === open.id);

  // First run: no schedule persisted yet.
  if (!s) {
    return (
      <motion.section className="home" key="first" {...fade}>
        <Aside />
        <div className="home-center">
          <p className="eyebrow"><span className="dot" />Set up · one time</p>
          <h1 className="headline">When should Still <span className="serif">check in</span>?</h1>
          <p className="lead">One short question at the same time each day. Still suggests one small step, then stops.</p>
          <ScheduleEditor onSaved={onSaved} />
        </div>
        <div className="home-side"><HowItWorks /></div>
      </motion.section>
    );
  }

  let center;
  if (editing) {
    center = (
      <motion.div key="edit" {...fade}>
        <p className="eyebrow">Edit schedule</p>
        <h1 className="headline">When should Still <span className="serif">check in</span>?</h1>
        <ScheduleEditor initial={s} submitLabel="Save schedule" onCancel={() => setEditing(false)}
          onSaved={(x) => { setEditing(false); onSaved(x); }} />
      </motion.div>
    );
  } else if (open?.status === "ready") {
    center = (
      <motion.div key="ready" {...fade}>
        <p className="eyebrow"><span className="dot" />Ready now</p>
        <h1 className="headline" style={{ fontSize: "clamp(2.5rem, 1.4rem + 4vw, 5rem)", lineHeight: 1.02 }}>
          Your check‑in is <span className="serif">ready</span>.
        </h1>
        <p className="lead">
          {open.source === "scheduled" ? `Scheduled for ${clock(open.due_at)}` : `Started ${clock(open.due_at)}`} · one question · about a minute.
        </p>
        <div className="actions">
          <Button size="lg" onClick={() => onBegin(open.id)} disabled={busy}>Begin check-in</Button>
          <button className="text-btn" onClick={() => onSkip(open.id)} disabled={busy}>Skip this one</button>
        </div>
      </motion.div>
    );
  } else if (open) {
    center = (
      <motion.div key="open" {...fade}>
        <p className="eyebrow"><span className="dot" />Check-in open</p>
        <h1 className="headline">You have a check‑in <span className="serif">in progress</span>.</h1>
        {haveSession ? (
          <div className="actions">
            {open.status === "in_progress"
              ? <Button size="lg" onClick={onResume}>Continue check-in</Button>
              : <Button size="lg" onClick={onFinish}>Finish check-in</Button>}
          </div>
        ) : (
          <p className="lead">It was started in another window. It closes on its own at {clock(open.closes_at)}.</p>
        )}
      </motion.div>
    );
  } else {
    const due = s.next_due_at;
    const t = due ? timeParts(due) : null;
    center = (
      <motion.div key={`next-${due}`} {...fade}>
        <p className="eyebrow">Next check-in</p>
        {t && due ? (
          <>
            <p className="bigtime" aria-label={`${dayLabel(due, now)} at ${clock(due)}`}>
              <span className="bigtime-num">{t.hm}</span><span className="bigtime-ampm">{t.ampm}</span>
            </p>
            <div className="when-row">
              <span>{dayLabel(due, now)}</span><span className="sep" aria-hidden />
              <span>{cadenceLabel(s.cadence)}</span><span className="sep" aria-hidden />
              <span className="countdown" aria-live="off">{countdown(due, now)}</span>
            </div>
          </>
        ) : (
          <h1 className="headline">Check-ins are paused.</h1>
        )}
        <div className="actions">
          <Button variant="outline" onClick={onCheckInNow} disabled={busy}>Check in now</Button>
          <button className="text-btn" onClick={() => setEditing(true)}>Edit schedule</button>
        </div>
        <p className="meta" style={{ marginTop: "var(--s-5)" }}>
          When it's due, it appears here. Still doesn't send notifications.
        </p>
      </motion.div>
    );
  }

  return (
    <section className="home">
      <Aside />
      <div className="home-center">
        <AnimatePresence mode="wait" initial={false}>{center}</AnimatePresence>
        {notice && <p className="notice" role="status">{notice}</p>}
      </div>
      <div className="home-side">
        <StillLife />
        <LastCheckin state={state} />
        <HowItWorks />
      </div>
    </section>
  );
}

function Aside() {
  return (
    <aside className="home-aside">
      <p className="home-tagline"><b>Still</b><br /><span>A scheduled check‑in.</span><br />Not a therapist. Not a chat.</p>
      <p className="meta" style={{ margin: 0, maxWidth: "24ch" }}>
        One question, one small step, then it ends. Human support is always one tap away.
      </p>
    </aside>
  );
}

/** Optional editorial image (web/public/still-life.jpg). Purely decorative; hidden if the file is absent. */
function StillLife() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className="still-life" src="/still-life.jpg" alt="" aria-hidden onError={() => setOk(false)} />;
}

function LastCheckin({ state }: { state: AppState }) {
  const l = state.last_checkin;
  if (!l) return <div className="side-block"><span className="label">Last check-in</span><p style={{ marginTop: 8 }}>None yet.</p></div>;
  const what: Record<string, string> = {
    completed: l.skill_title ? `Closed after one step: ${l.skill_title}.` : "Closed.",
    help_shown: "Ended with human support.",
    skipped: "Skipped.",
    expired: "Not started — it expired.",
    abandoned: "Left unfinished — it closed on its own.",
  };
  return (
    <div className="side-block">
      <span className="label">Last check-in</span>
      <h3 style={{ marginTop: 8 }}>{what[l.status] ?? "Closed."}</h3>
      {l.closed_at && <p>{dayLabel(l.closed_at, state.now)} · {clock(l.closed_at)}</p>}
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="side-cta">
      <h3>See exactly how a check‑in works.</h3>
      <a className="btn btn-outline" href="#/protocol" style={{ width: "fit-content" }}>
        <span>Protocol</span><span className="btn-arrow" aria-hidden><ArrowUpRight size={18} strokeWidth={1.75} /></span>
      </a>
    </div>
  );
}
