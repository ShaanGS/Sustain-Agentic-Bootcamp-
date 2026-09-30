// Explicit safety backstop. Deterministic, local, no network.
// Runs before any model call; a hit ends the ordinary flow and the model is never called.
import { crisisPhrases, type CrisisCategory } from "../config.js";

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u2018\u2019'`]/g, "")      // "don't" -> "dont"
    .replace(/[^\p{L}\p{N}]+/gu, " ")       // punctuation/emoji -> space
    .replace(/\s+/g, " ")
    .trim();
}

const compile = (p: string) => new RegExp(`(?:^|\\s)${normalise(p).replace(/ /g, "\\s+")}(?:\\s|$)`);
// Emergency is checked first so poisoning/overdose lead with 112.
const ORDER: CrisisCategory[] = ["emergency", "self_harm"];
const patterns = ORDER.map((c) => ({ category: c, res: crisisPhrases.categories[c].map(compile) }));

/** The category of the first reviewed phrase found (word-bounded), or null. */
export function crisisPhraseMatch(text: string): CrisisCategory | null {
  const n = normalise(text);
  for (const { category, res } of patterns) if (res.some((re) => re.test(n))) return category;
  return null;
}

export const crisisPhraseHit = (text: string) => crisisPhraseMatch(text) !== null;
