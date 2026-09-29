import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Props = Omit<ComponentProps<typeof motion.button>, "children"> & {
  variant?: "primary" | "outline";
  size?: "md" | "lg";
  arrow?: boolean;
  children: ReactNode;
};

/** Pill action with the circular arrow (primary actions only). */
export function Button({ variant = "primary", size = "md", arrow = true, className = "", children, ...rest }: Props) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={`btn btn-${variant} ${size === "lg" ? "btn-lg" : ""} ${arrow ? "" : "btn-plain"} ${className}`}
      {...rest}
    >
      <span>{children}</span>
      {arrow && (
        <span className="btn-arrow" aria-hidden>
          <ArrowRight size={size === "lg" ? 20 : 18} strokeWidth={1.75} />
        </span>
      )}
    </motion.button>
  );
}
