// Loads the reviewed static configuration and environment settings.
// Everything a student can be shown as help or advice comes from config/*.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(root, "config", name), "utf8")) as T;

export interface HelplineNumber { display: string; tel: string }
export interface Helpline {
  id: string; name: string; description: string; numbers: HelplineNumber[];
  source_url: string; verified_on: string; verified_by: string; tags?: string[];
}
export interface Skill { id: string; title: string; summary: string; minutes: number; steps: string[] }
export interface Need { id: string; label: string; clarify_label: string; skill_id: string }

export const helplines = readJson<{ primary: Helpline; emergency: Helpline }>("helplines.json");
const skillsFile = readJson<{ review: { reviewed_by: string; reviewed_on: string }; skills: Skill[] }>("skills.json");
export const skills = skillsFile.skills;
export const skillsReview = skillsFile.review;
export const needs = readJson<{ needs: Need[] }>("needs.json").needs;
export const crisisPhrases = readJson<{ reviewed_on: string; phrases: string[] }>("crisis-phrases.json");
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
    dbPath: e.STILL_DB_PATH || join(root, "data", "still.db"),
    schedulerTickMs: Number(e.SCHEDULER_TICK_MS) || 15000,
  };
}
