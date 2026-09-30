// Loads the reviewed static configuration and environment settings.
// Everything a student can be shown as help or advice comes from config/*.json.
// JSON is imported statically so a bundled serverless function carries it with it.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import helplinesJson from "../config/helplines.json" with { type: "json" };
import skillsJson from "../config/skills.json" with { type: "json" };
import needsJson from "../config/needs.json" with { type: "json" };
import crisisJson from "../config/crisis-phrases.json" with { type: "json" };
import checkinJson from "../config/checkin.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(name: string): T => ({
  "helplines.json": helplinesJson, "skills.json": skillsJson, "needs.json": needsJson,
  "crisis-phrases.json": crisisJson, "checkin.json": checkinJson,
} as Record<string, unknown>)[name] as T;

export interface HelplineNumber { display: string; tel: string }
export interface Helpline {
  id: string; name: string; description: string; numbers: HelplineNumber[];
  source_url: string; verified_on: string; verified_by: string; tags?: string[];
}
export type ExecutorType = "FOCUS_TIMER" | "BREATHING_GUIDE" | "COPY_MESSAGE" | "GUIDED_RESET" | "ACKNOWLEDGE";
/** Server-controlled executor definition. The model can never set type, duration or limits. */
export interface ExecutorDef {
  type: ExecutorType; label: string; cta: string;
  duration_s?: number; default_target?: string; message?: string;
  phases?: { label: string; seconds: number }[]; rounds?: number; cues?: string[];
}
export interface Skill {
  id: string; title: string; summary: string; minutes: number; next_step: string; steps: string[]; executor: ExecutorDef;
}
export interface Need { id: string; label: string; clarify_label: string; skill_id: string }

export const helplines = readJson<{ primary: Helpline; emergency: Helpline }>("helplines.json");
const skillsFile = readJson<{ review: { reviewed_by: string; reviewed_on: string }; skills: Skill[] }>("skills.json");
export const skills = skillsFile.skills;
export const skillsReview = skillsFile.review;
export const needs = readJson<{ needs: Need[] }>("needs.json").needs;
export type CrisisCategory = "self_harm" | "emergency";
export const crisisPhrases = readJson<{ reviewed_on: string; categories: Record<CrisisCategory, string[]> }>("crisis-phrases.json");
export const crisisPhraseCount = Object.values(crisisPhrases.categories).reduce((n, l) => n + l.length, 0);
export const checkinConfig = readJson<{
  prompt: string; prompt_hint: string; max_chars: number;
  ready_window_minutes: number; in_progress_timeout_minutes: number;
}>("checkin.json");

export const NEED_IDS = needs.map((n) => n.id);
export const skillById = (id: string) => skills.find((s) => s.id === id);
export const needById = (id: string) => needs.find((n) => n.id === id);

// Fail fast if the policy table points at a skill that is not on the reviewed list.
for (const n of needs) {
  if (!skillById(n.skill_id)) throw new Error(`needs.json: ${n.id} -> unknown skill ${n.skill_id}`);
}
const EXECUTOR_TYPES: ExecutorType[] = ["FOCUS_TIMER", "BREATHING_GUIDE", "COPY_MESSAGE", "GUIDED_RESET", "ACKNOWLEDGE"];
for (const s of skills) {
  if (!EXECUTOR_TYPES.includes(s.executor?.type)) throw new Error(`skills.json: ${s.id} has no allowlisted executor`);
  if (s.executor.duration_s !== undefined && (s.executor.duration_s <= 0 || s.executor.duration_s > 1800)) {
    throw new Error(`skills.json: ${s.id} executor duration out of bounds`);
  }
}

export type ProviderName = "groq" | "ollama" | "local";

export interface Env {
  provider: ProviderName;
  groqApiKey: string;
  groqModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  classifierTimeoutMs: number;
  port: number;
  dbPath: string;
  /** Postgres (e.g. Neon on Vercel). When set, it is used instead of SQLite. */
  databaseUrl?: string;
  schedulerTickMs: number;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const provider = (e.CLASSIFIER_PROVIDER ?? "local").toLowerCase();
  if (!["groq", "ollama", "local"].includes(provider)) {
    throw new Error(`CLASSIFIER_PROVIDER must be groq, ollama or local (got "${provider}")`);
  }
  return {
    provider: provider as ProviderName,
    groqApiKey: e.GROQ_API_KEY ?? "",
    groqModel: e.GROQ_MODEL || "llama-3.1-8b-instant",
    ollamaUrl: e.OLLAMA_URL || "http://localhost:11434",
    ollamaModel: e.OLLAMA_MODEL || "llama3.2:3b",
    classifierTimeoutMs: Number(e.CLASSIFIER_TIMEOUT_MS) || 6000,
    port: Number(e.PORT) || 8787,
    dbPath: e.STILL_DB_PATH || (e.VERCEL ? "/tmp/still.db" : join(root, "data", "still.db")),
    databaseUrl: e.DATABASE_URL || e.POSTGRES_URL || undefined,
    schedulerTickMs: Number(e.SCHEDULER_TICK_MS) || 15000,
  };
}
