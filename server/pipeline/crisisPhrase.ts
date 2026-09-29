// Explicit crisis phrase backstop. Deterministic, local, no network.
// Runs before any classifier; a hit ends the ordinary flow immediately.
import { crisisPhrases } from "../config.js";

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’'`]/g, "")      // "don't" -> "dont"
    .replace(/[^\p{L}\p{N}]+/gu, " ")       // punctuation/emoji -> space
    .replace(/\s+/g, " ")
    .trim();
}

const patterns = crisisPhrases.phrases.map((p) => {
  const n = normalise(p).replace(/ /g, "\\s+");
  return new RegExp(`(?:^|\\s)${n}(?:\\s|$)`);
});

/** True if any reviewed crisis phrase appears (word-bounded) in the text. */
export function crisisPhraseHit(text: string): boolean {
  const n = normalise(text);
  return patterns.some((re) => re.test(n));
}
