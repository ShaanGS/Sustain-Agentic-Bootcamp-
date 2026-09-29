import { motion } from "motion/react";
import { Lock } from "lucide-react";
import type { AppState } from "../lib/api";
import { cadenceLabel, clock, dayLabel } from "../lib/format";
import { Button } from "../components/Button";

export function Done({ state, stepTitle, onHome }: { state: AppState; stepTitle: string | null; onHome: () => void }) {
  const s = state.schedule;
  return (
    <motion.section className="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, ease: [0.2, 0, 0, 1] }}>
      <p className="eyebrow"><span className="dot" />Check-in closed</p>
      <h1 className="headline" style={{ fontSize: "clamp(2.75rem, 1.6rem + 5vw, 6rem)", lineHeight: 1 }}>
        That's it for <span className="serif">now</span>.
      </h1>
      <p className="lead">{stepTitle ? `You left with one step: ${stepTitle}.` : "Closed without a step."} Still won't follow up until your next check-in.</p>
      <div className="next-row">
        <span className="label">Next check-in</span>
        <span className="v tnum">{s?.next_due_at ? `${dayLabel(s.next_due_at, state.now)} · ${clock(s.next_due_at)}` : "Not scheduled"}</span>
        {s && <span className="meta">{cadenceLabel(s.cadence)}</span>}
      </div>
      <div className="bar" style={{ borderTop: 0, paddingTop: 0 }}>
        <span className="privacy"><Lock size={14} strokeWidth={1.75} aria-hidden />Your response isn't stored by Still.</span>
        <Button variant="outline" onClick={onHome}>Return home</Button>
      </div>
    </motion.section>
  );
}
