import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Photo } from "./Photo";

/** The reviewed skills card, as a carousel (ref 1 bottom-left). Data comes from /api/protocol. */
export function SkillsCarousel({ skills }: { skills: { id: string; title: string; summary: string }[] }) {
  const [i, setI] = useState(0);
  if (!skills.length) return null;
  const n = skills.length;
  const cur = skills[i];
  const prev = skills[(i - 1 + n) % n];
  return (
    <div>
      <div className="carousel-nav">
        <button className="arrow" aria-label="Previous skill" onClick={() => setI((i - 1 + n) % n)}><ChevronLeft size={20} /></button>
        <button className="arrow strong" aria-label="Next skill" onClick={() => setI((i + 1) % n)}><ChevronRight size={20} /></button>
      </div>
      <div className="carousel" style={{ marginTop: 24 }}>
        <div className="card-photo peek"><Photo name={prev.id} /></div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={cur.id} className="card-photo main"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <Photo name={cur.id} />
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="carousel-cap"><b>{cur.title}</b> — {cur.summary}<br />Reviewed skill {i + 1} of {n}</p>
    </div>
  );
}
