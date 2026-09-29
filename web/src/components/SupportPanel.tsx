import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Helplines } from "../lib/api";
import { verifiedOn } from "../lib/format";

/** Quiet, always-available route to people. Opening it does not change the check-in. */
export function SupportPanel({ open, onClose, helplines }: { open: boolean; onClose: () => void; helplines: Helplines | undefined }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && helplines && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
          <motion.aside
            className="panel" role="dialog" aria-modal="true" aria-labelledby="support-title"
            initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          >
            <div className="panel-head">
              <h2 id="support-title">Human support</h2>
              <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <p style={{ margin: 0, color: "var(--ink-2)" }}>
              Still is not a therapist or a crisis service. If you'd like to talk to a person, these are free public lines.
            </p>
            {[helplines.primary, helplines.emergency].map((h) => (
              <div className="panel-line" key={h.id}>
                <span className="label">{h.id === "erss_112" ? "Immediate danger" : h.name}</span>
                <a className="panel-number" href={`tel:${h.numbers[0].tel}`}>{h.numbers[0].display}</a>
                <span className="meta">{h.description}</span>
                {h.numbers.slice(1).map((n) => (
                  <span className="meta" key={n.tel}>Also <a href={`tel:${n.tel}`}>{n.display}</a></span>
                ))}
              </div>
            ))}
            <p className="meta" style={{ marginTop: "auto" }}>
              Still has not contacted anyone. Numbers from reviewed configuration, verified {verifiedOn(helplines.primary.verified_on)}.
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
