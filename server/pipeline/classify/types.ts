import type { Validated } from "./schema.js";

export type ClassifierSource = "groq" | "ollama" | "local";

export interface ClassifierInfo {
  provider: ClassifierSource;
  model: string;
  /** Whether the student's text leaves this machine when this classifier runs. */
  sends_text_off_machine: boolean;
  destination: string;
}

/**
 * ms: time spent getting a label (model call or rules), excluding validation.
 * validate_ms: time spent validating the label; absent if validation never ran (e.g. timeout).
 */
export type ClassifyResult = { source: ClassifierSource; ms: number; validate_ms?: number } & Validated;

export interface Classifier {
  info: ClassifierInfo;
  /** Must never throw: failures return { ok: false, reason }. */
  classify(text: string): Promise<ClassifyResult>;
}
