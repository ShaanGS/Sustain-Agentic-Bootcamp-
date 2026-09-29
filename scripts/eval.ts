// Runs fixture lines through the real pipeline (phrase backstop → classifier → validate → policy).
// Usage: npm run eval [-- --provider groq|ollama|local]
import { readFileSync } from "node:fs";
import { readEnv } from "../server/config.js";
import { makeClassifier } from "../server/pipeline/classify/index.js";
import { crisisPhraseHit } from "../server/pipeline/crisisPhrase.js";
import { decide } from "../server/pipeline/policy.js";

try { process.loadEnvFile?.(); } catch { /* no .env */ }
const i = process.argv.indexOf("--provider");
if (i > -1) process.env.CLASSIFIER_PROVIDER = process.argv[i + 1];
const classifier = makeClassifier(readEnv());
const { lines } = JSON.parse(readFileSync(new URL("../fixtures/lines.json", import.meta.url), "utf8")) as
  { lines: { text: string; expect: string }[] };

console.log(`classifier: ${classifier.info.provider}/${classifier.info.model} (${classifier.info.destination})\n`);
let pass = 0;
for (const { text, expect } of lines) {
  const hit = crisisPhraseHit(text);
  const r = hit ? null : await classifier.classify(text);
  const d = decide(hit, r);
  const got = d.action === "skill" ? `skill:${d.skill.id}` : d.action;
  const ok = expect.split("|").includes(got);
  if (ok) pass++;
  const via = hit ? "phrase" : r!.ok ? `${r!.source} ${r!.classification}` : `${r!.source} FAILED(${r!.reason})`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${got.padEnd(24)} via ${via.padEnd(26)} "${text}"`);
}
console.log(`\n${pass}/${lines.length} matched expected routes`);
process.exitCode = pass === lines.length ? 0 : 1;
