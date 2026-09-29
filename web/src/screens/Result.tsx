import { motion } from "motion/react";
import { Lock } from "lucide-react";
import type { ClassifierInfo, RouteResult } from "../lib/api";
import { Button } from "../components/Button";
import { Trace } from "../components/Trace";

type SkillResult = Extract<RouteResult, { route: "skill" }>;

const list = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.2, 0, 0, 1] as const } } };

/** The signature screen: one reviewed step, and exactly why it was chosen. */
export function Result({ result, classifier, via, closing, onDone }: {
  result: SkillResult;
  classifier: ClassifierInfo;
  via: "classifier" | "clarify";
  closing: boolean;
  onDone: () => void;
}) {
  const { skill } = result;
  const nothingToDo = skill.id === "CLOSE_OK";
  return (
    <section className="result">
      <div>
        <p className="eyebrow"><span className="dot" />{nothingToDo ? "No step needed" : "One next step"}</p>
        <h1 className="skill-title">{skill.title}</h1>
        <p className="skill-summary">{skill.summary}</p>
        <motion.ol className="steps" variants={list} initial="hidden" animate="show">
          {skill.steps.map((s, i) => (
            <motion.li key={i} variants={item}>
              <span className="step-n">{String(i + 1).padStart(2, "0")}</span><span>{s}</span>
            </motion.li>
          ))}
        </motion.ol>
        {skill.minutes > 0 && <p className="meta minutes">About {skill.minutes} {skill.minutes === 1 ? "minute" : "minutes"}.</p>}
        <div className="bar">
          <span className="privacy"><Lock size={14} strokeWidth={1.75} aria-hidden />Your response isn't stored by Still.</span>
          <Button size="lg" onClick={onDone} disabled={closing}>{closing ? "Closing…" : "Done"}</Button>
        </div>
      </div>

      <div className="why">
        <p className="why-sentence">
          {via === "clarify" ? "You chose " : "Your response matched "}
          <em>{result.matched_label}</em>, so Still offered the one reviewed step for that. It didn't write this advice.
        </p>
        <dl className="kv">
          <dt>Matched</dt><dd>{result.matched_label}</dd>
          <dt>Selected</dt><dd>{result.selected_action}</dd>
          <dt>Decided by</dt><dd>{via === "clarify" ? "Your choice → policy table" : `${classifier.provider} · ${classifier.model} → policy table`}</dd>
        </dl>
        <Trace steps={result.trace} totalMs={result.total_ms} />
      </div>

    </section>
  );
}
