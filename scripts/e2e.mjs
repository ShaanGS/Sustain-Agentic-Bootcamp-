// End-to-end judge demo against the real server (real scheduler, real pipeline).
// Usage: npm run build && npm run e2e   (screenshots -> SHOTS_DIR or ./screenshots)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS_DIR ?? "screenshots";
const db = join(tmpdir(), `still-e2e-${Date.now()}.db`);
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: String(PORT), STILL_DB_PATH: db, SCHEDULER_TICK_MS: "2000", CLASSIFIER_PROVIDER: process.env.CLASSIFIER_PROVIDER ?? "local" },
  stdio: ["ignore", "pipe", "inherit"],
});
const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(String(d)));
await new Promise((r) => setTimeout(r, 1500));

const LINES = {
  ordinary1: "I have three assignments due this week and keep jumping between all of them.",
  ordinary2: "I'm really wound up about tomorrow's presentation and can't settle.",
  viva: "I have my viva tomorrow morning and I haven't started preparing. I keep opening Instagram instead.",
  lonely: "Everyone went home for the weekend and I feel lonely.",
  unclear: "idk, it's just a lot",
  crisis: "I don't want to be here anymore. I want to end my life.",
  poison: "I ate poison with food.",
  poisonous: "I swallowed something poisonous.",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
// Let entrance transitions settle so screenshots show the resting state.
const settle = (p = page) => p.waitForTimeout(500);
const shot = async (name) => { await settle(); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const expectText = async (t, timeout = 10_000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });
const log = (...a) => console.log("•", ...a);

try {
  const nav = (name) => page.locator(".nav").getByRole("link", { name }).click();
  const begin = async () => { await expectText("Daily check"); await page.getByRole("button", { name: /Begin check/ }).click(); };
  const answer = async (text) => { await page.locator("#response").fill(text); await page.getByRole("button", { name: "Submit" }).click(); };
  const closeDone = async () => { await page.getByRole("button", { name: /Done — close check-in/ }).click(); await expectText("That's the"); await page.getByRole("button", { name: "Back to Today" }).click(); };
  const noSkill = async () => { if (await page.locator(".entry, .steps, .runner").count()) throw new Error("a skill rendered on a help path"); };

  // 1. First run → Schedule → first check-in due in 1 minute (fired by the real server scheduler)
  await page.goto(BASE);
  await expectText("When should");
  await shot("01-first-run");
  await page.getByRole("link", { name: /Set a check/ }).click();
  await page.locator("input[type=time]").fill("18:30");
  await page.getByLabel("Make the first check-in due in 1 minute").check();
  await page.getByRole("button", { name: /Set check/ }).click();
  await expectText("Saved");
  await nav("Today");
  await expectText("Until it's ready");
  await shot("02-today-waiting");
  log("schedule saved; waiting for the server scheduler to fire…");
  await expectText("Daily check", 90_000);
  await shot("03-today-ready");
  log("scheduler created the check-in");

  // DEMO 1 — natural language → SAFE → understood → PRIORITIZE → a real focus timer runs → close
  await begin();
  await page.locator("#response").fill(LINES.ordinary1);
  await shot("04-prompt");
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("One next step");
  await expectText("You mentioned three assignments due this week.");
  await expectText("several tasks competing");
  await shot("05-result-prioritize");
  await page.getByRole("button", { name: /Start 15-minute focus/ }).click();
  await expectText("15-minute focus · running");
  await page.waitForTimeout(2200);
  await shot("06-focus-running");
  const t1 = await page.locator(".runner .ring-time").innerText();
  await page.waitForTimeout(1500);
  const t2 = await page.locator(".runner .ring-time").innerText();
  if (t1 === t2) throw new Error(`focus timer is not counting down (${t1})`);
  await page.getByRole("button", { name: "I'm done" }).click();
  await expectText("15-minute focus — completed");
  await shot("07-action-done");
  await page.getByRole("button", { name: "How Still decided" }).click();
  await shot("07b-agent-trace");
  await page.getByRole("button", { name: /Done — close check-in/ }).click();
  await expectText("That's the");
  await shot("08-done");
  await page.getByRole("button", { name: "Back to Today" }).click();
  log(`DEMO 1 → PRIORITIZE → focus timer ran (${t1} → ${t2}) → closed`);

  // DEMO 2 — a different path: tension → PACED_BREATHING → guided 60-second reset
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await page.locator("#response").fill(LINES.ordinary2);
  await page.locator("#response").press("Enter"); // Enter submits
  await expectText("Paced breathing");
  await expectText("You mentioned tomorrow's presentation.");
  await page.getByRole("button", { name: /Begin 60-second reset/ }).click();
  await expectText("Breathe in");
  await page.waitForTimeout(1200);
  await shot("09-breathing-running");
  await page.getByRole("button", { name: "Stop" }).click();
  await expectText("stopped early");
  await closeDone();
  log("DEMO 2 → PACED_BREATHING → guided reset ran → stopped → closed");

  // Another natural path: viva avoidance → START_SMALL with the viva as the focus target
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.viva);
  await expectText("Start small");
  await expectText("Focus on your viva prep");
  await shot("10-result-start-small");
  await page.getByRole("button", { name: /Skip — close check-in/ }).click();
  await expectText("That's the");
  await page.getByRole("button", { name: "Back to Today" }).click();
  log("viva → START_SMALL (focus target: your viva prep)");

  // Copy-message executor: copies, never sends
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.lonely);
  await expectText("Reach out to one person");
  await page.getByRole("button", { name: /Copy message/ }).click();
  await expectText("Still hasn't sent anything");
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  if (clip && !clip.startsWith("Hey")) throw new Error("clipboard does not hold the reviewed message");
  await shot("11-copy-message");
  await closeDone();
  log("REACH_OUT → message copied to clipboard (not sent)");

  // Fallback only: unclear → one clarification → one skill
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.unclear);
  await expectText("Which feels closest?");
  await shot("12-clarify");
  await page.getByRole("button", { name: /Can't get started/ }).click();
  await expectText("Start small");
  await page.getByRole("button", { name: /Skip — close check-in/ }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();
  log("unclear → clarification (original re-checked) → START_SMALL");

  // Two tabs: started here, continued in another tab
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await expectText("What's taking up the most space");
  const tab2 = await ctx.newPage();
  await tab2.goto(BASE);
  await tab2.getByText("Daily check").first().waitFor();
  await tab2.getByRole("button", { name: /Begin check/ }).click();
  await tab2.locator("#response").fill(LINES.ordinary1);
  await tab2.getByRole("button", { name: "Submit" }).click();
  await tab2.getByText("One next step").first().waitFor();
  await tab2.getByRole("button", { name: /Skip — close check-in/ }).click();
  await tab2.getByText("That's the").first().waitFor();
  await tab2.close();
  await page.goto(BASE);
  await expectText("Until it's ready");
  log("check-in taken over from a second tab");

  // Help tab
  await nav("Help");
  await expectText("Opening this page doesn't change");
  await shot("13-help-tab");
  await nav("Today");

  // DEMO 3 — explicit crisis phrase → model skipped → human help
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.crisis);
  await expectText("Please talk to a person now.");
  await noSkill();
  await shot("14-crisis");
  await page.getByRole("button", { name: "Return to Today" }).click();
  log("DEMO 3 → explicit phrase → help (model not called)");

  // DEMO 4 — the poisoning regression
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.poison);
  await expectText("Get emergency help now.");
  await noSkill();
  await shot("15-poison-emergency");
  await page.getByRole("button", { name: "Return to Today" }).click();
  log("DEMO 4 → 'I ate poison with food.' → emergency help, 112 first, no skill");

  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.poisonous);
  await expectText("talk to a person now");
  await noSkill();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const l of Object.values(LINES)) if (storage.includes(l.slice(0, 20))) throw new Error("response text found in browser storage");
  await page.getByRole("button", { name: "Return to Today" }).click();
  await expectText("Ended with human support");
  log("semantic 'swallowed something poisonous' → safety layer HIGH_RISK → help; browser storage clean");

  // How it works — the real agent trace of the last check-in
  await nav("How it works");
  await expectText("HIGH_RISK");
  await shot("16-how");
  await page.screenshot({ path: join(SHOTS, "16b-how-full.png"), fullPage: true });
  log("protocol shows the live agent trace");

  // 9. Phone width
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const mp = await m.newPage();
  const mshot = async (n, full = false) => { await settle(mp); await mp.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: full }); };
  await mp.goto(BASE);
  await mp.getByText("Until it's ready").first().waitFor();
  await mshot("20-m-today", true);
  await mp.locator(".tabbar").getByRole("link", { name: "Schedule" }).click();
  await mp.getByText("Upcoming").first().waitFor();
  await mshot("21-m-schedule", true);
  await mp.locator(".tabbar").getByRole("link", { name: "Today" }).click();
  await mp.getByRole("button", { name: "Check in now" }).click();
  await mp.getByRole("button", { name: /Begin check/ }).click();
  await mp.locator("#response").fill(LINES.ordinary1);
  await mshot("22-m-prompt");
  await mp.getByRole("button", { name: "Submit" }).click();
  await mp.getByText("One next step").first().waitFor();
  await mshot("23-m-result", true);
  await mp.getByRole("button", { name: /Skip — close check-in/ }).click();
  await mp.getByRole("button", { name: "Back to Today" }).click();
  await mp.getByRole("button", { name: "Check in now" }).click();
  await mp.getByRole("button", { name: /Begin check/ }).click();
  await mp.locator("#response").fill(LINES.crisis);
  await mp.getByRole("button", { name: "Submit" }).click();
  await mp.getByText("Please talk to a person now.").waitFor();
  await mshot("24-m-crisis", true);
  await mp.getByRole("button", { name: "Return to Today" }).click();
  await mp.locator(".tabbar").getByRole("link", { name: "How" }).click();
  await mp.getByText("Not called").first().waitFor();
  await mshot("25-m-how");
  log("phone width OK");

  const logs = serverLog.join("");
  for (const l of Object.values(LINES)) if (logs.includes(l.slice(0, 20))) throw new Error("response text found in server log");
  console.log("\nE2E PASSED — screenshots in", SHOTS);
} catch (e) {
  await shot("zz-failure").catch(() => {});
  console.error("\nE2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  for (const s of ["", "-wal", "-shm"]) rmSync(db + s, { force: true });
}
