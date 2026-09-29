import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Props = Omit<ComponentProps<typeof motion.button>, "children"> & {
  variant?: "dark" | "light" | "soft" | "outline";
  arrow?: boolean;
  block?: boolean;
  children: ReactNode;
};

/** Pill button; primary actions carry the round arrow (refs 3/4). */
export function Button({ variant = "dark", arrow = true, block = false, className = "", children, ...rest }: Props) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} transition={{ duration: 0.12 }}
      className={`btn btn-${variant} ${arrow ? "" : "btn-plain"} ${block ? "btn-block" : ""} ${className}`} {...rest}>
      <span>{children}</span>
      {arrow && <span className="ico" aria-hidden><ArrowRight size={20} strokeWidth={2} /></span>}
    </motion.button>
  );
}
