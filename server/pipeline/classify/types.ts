import type { Validated } from "./schema.js";

export type ClassifierSource = "groq" | "ollama" | "local";

export interface ClassifierInfo {
  provider: ClassifierSource;
  model: string;
  /** Whether the student's text leaves this machine when this classifier runs. */
  sends_text_off_machine: boolean;
  destination: string;
}

export type ClassifyResult = { source: ClassifierSource; ms: number } & Validated;

export interface Classifier {
  info: ClassifierInfo;
  /** Must never throw: failures return { ok: false, reason }. */
  classify(text: string): Promise<ClassifyResult>;
}
