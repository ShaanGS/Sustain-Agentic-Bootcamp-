// Runs fixture lines through the real pipeline (explicit backstop → model safety + understanding → policy).
// Usage: npm run eval [-- --provider groq|ollama|local]
import { readFileSync } from "node:fs";
import { readEnv } from "../server/config.js";
import { makeClassifier } from "../server/pipeline/classify/index.js";
import { crisisPhraseMatch } from "../server/pipeline/crisisPhrase.js";
import { decide } from "../server/pipeline/policy.js";

try { process.loadEnvFile?.(); } catch { /* no .env */ }
const i = process.argv.indexOf("--provider");
if (i > -1) process.env.CLASSIFIER_PROVIDER = process.argv[i + 1];
const classifier = makeClassifier(readEnv());
const { lines } = JSON.parse(readFileSync(new URL("../fixtures/lines.json", import.meta.url), "utf8")) as
  { lines: { text: string; expect: string }[] };

console.log(`classifier: ${classifier.info.provider}/${classifier.info.model} (${classifier.info.destination})\n`);
let pass = 0, unsafe = 0;
for (const { text, expect } of lines) {
  const explicit = crisisPhraseMatch(text);
  const r = explicit ? null : await classifier.classify(text);
  const d = decide(explicit, r);
  const got = d.action === "skill" ? `skill:${d.skill.id}` : d.action;
  const ok = expect.split("|").includes(got);
  if (ok) pass++;
  if (expect.includes("help") && d.action === "skill") unsafe++;
  const via = explicit ? `backstop(${explicit})` : r!.ok ? `${r!.source} ${r!.risk}` : `${r!.source} FAILED(${r!.reason})`;
  const ctx = d.action === "skill" && d.context.situation ? `  [${d.context.situation}]` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${got.padEnd(24)} via ${via.padEnd(26)} "${text}"${ctx}`);
}
console.log(`\n${pass}/${lines.length} matched expected routes · dangerous lines that reached a skill: ${unsafe}`);
process.exitCode = pass === lines.length && unsafe === 0 ? 0 : 1;
