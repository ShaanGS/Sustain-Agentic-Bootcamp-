import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { StartResult } from "../lib/api";
import { Button } from "../components/Button";

/** Focused mode: one question, one writing surface, one submit. */
export function Prompt({ start, submitting, error, initialText, onSubmit }: {
  start: StartResult;
  submitting: boolean;
  error: string | null;
  initialText: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const trimmed = text.trim();
  const near = text.length > start.max_chars * 0.85;
  const submit = () => { if (trimmed && !submitting) onSubmit(text); };

  return (
    <section className="focus">
      <div className="focus-inner">
        <p className="eyebrow"><span className="dot" />Check-in · one question</p>
        <h1 className="prompt-q">{start.prompt}</h1>
        {submitting ? (
          <Processing />
        ) : (
          <>
            <div className="write">
              <label className="sr-only" htmlFor="response">Your response</label>
              <textarea
                id="response" ref={ref} value={text} maxLength={start.max_chars}
                placeholder="A sentence or two is enough."
                autoComplete="off" spellCheck
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              />
            </div>
            <div className="write-foot">
              <div className="write-meta">
                <span className="meta">{start.prompt_hint}</span>
              </div>
              <div className="write-meta">
                <span className="counter tnum" data-near={near}>{text.length} / {start.max_chars}</span>
                <span className="kbd" aria-hidden>Ctrl ↵</span>
                <Button onClick={submit} disabled={!trimmed}>Submit</Button>
              </div>
            </div>
            {error && <p className="notice" role="alert">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** Shown only while the real /respond request is in flight. No simulated steps, no timer. */
function Processing() {
  return (
    <motion.div className="processing" role="status" aria-live="polite"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <div>
        <h3>Checking your response</h3>
        <p>Safety check first, then one next step.</p>
      </div>
      <div className="inflight" aria-hidden />
    </motion.div>
  );
}
