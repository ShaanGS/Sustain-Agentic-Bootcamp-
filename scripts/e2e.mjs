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
  unclear: "idk, it's just a lot",
  crisis: "I don't want to be here anymore. I want to end my life.",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
  const finish = async () => { await page.getByRole("button", { name: /^Done/ }).click(); await expectText("That's the"); };

  // 1. First run → Schedule tab → set a check-in due in 1 minute (fired by the real server scheduler)
  await page.goto(BASE);
  await expectText("When should");
  await shot("01-first-run");
  await page.getByRole("link", { name: /Set a check/ }).click();
  await expectText("schedule");
  await page.locator("input[type=time]").fill("18:30");
  await page.getByLabel("Make the first check-in due in 1 minute").check();
  await shot("02-schedule");
  await page.getByRole("button", { name: /Set check/ }).click();
  await expectText("Saved");
  await shot("02b-schedule-saved");
  await nav("Today");
  await expectText("Until it's ready");
  await shot("03-today-waiting");
  log("schedule saved; waiting for the server scheduler to fire…");

  // 2. The scheduler makes it ready
  await expectText("Daily check", 90_000);
  await shot("04-today-ready");
  log("scheduler created the check-in");

  // 3. Ordinary path #1
  await begin();
  await expectText("What's taking up the most space");
  await page.locator("#response").fill(LINES.ordinary1);
  await shot("05-prompt");
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("One next step");
  await expectText("Prioritize");
  await shot("06-result");
  await page.getByRole("button", { name: "How Still decided" }).click();
  await shot("06b-result-trace");
  await finish();
  await shot("07-done");
  await page.getByRole("button", { name: "Back to Today" }).click();
  log("ordinary #1 → Prioritize");

  // 4. Ordinary path #2 via "Check in now" (same creation path as the scheduler)
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await page.locator("#response").fill(LINES.ordinary2);
  await page.locator("#response").press("Enter"); // Enter submits

  await expectText("Paced breathing");
  await shot("08-result-breathing");
  await finish();
  await page.getByRole("button", { name: "Back to Today" }).click();
  log("ordinary #2 → Paced breathing");

  // 5. Unclear → clarify → one tap
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.unclear);
  await expectText("Which feels closest?");
  await shot("09-clarify");
  await page.getByRole("button", { name: /Can't get started/ }).click();
  await expectText("Ten-minute start");
  await finish();
  await page.getByRole("button", { name: "Back to Today" }).click();
  log("unclear → clarify → Ten-minute start");

  // 5b. Started in one tab, continued in another (session tokens are per tab)
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await expectText("What's taking up the most space");
  const tab2 = await ctx.newPage();
  await tab2.goto(BASE);
  await tab2.getByText("Daily check").first().waitFor(); // same green card as a fresh check-in
  await tab2.waitForTimeout(400);
  await tab2.screenshot({ path: join(SHOTS, "09b-other-tab.png") });
  await tab2.getByRole("button", { name: /Begin check/ }).click();
  await tab2.locator("#response").fill(LINES.ordinary1);
  await tab2.getByRole("button", { name: "Submit" }).click();
  await tab2.getByText("One next step").first().waitFor();
  await tab2.getByRole("button", { name: /^Done/ }).click();
  await tab2.getByText("That's the").first().waitFor();
  await tab2.close();
  await page.goto(BASE);
  await expectText("Until it's ready");
  log("check-in taken over from a second tab");

  // 6. Help tab (always reachable)
  await nav("Help");
  await expectText("Opening this page doesn't change");
  await shot("10-help-tab");
  await nav("Today");

  // 7. Crisis → normal flow stops → human help
  await page.getByRole("button", { name: "Check in now" }).click();
  await begin();
  await answer(LINES.crisis);
  await expectText("Please talk to a person now.");
  if (await page.locator(".entry, .steps").count()) throw new Error("a skill rendered on the crisis path");
  await shot("11-crisis");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const l of Object.values(LINES)) if (storage.includes(l.slice(0, 20))) throw new Error("response text found in browser storage");
  await page.getByRole("button", { name: "Return to Today" }).click();
  await expectText("Ended with human support");
  await shot("12-today-after-crisis");
  log("crisis → human help; browser storage holds no response text");

  // 8. How it works, live
  await nav("How it works");
  await expectText("skipped · not called");
  await shot("13-how");
  await page.screenshot({ path: join(SHOTS, "13b-how-full.png"), fullPage: true });
  log("how-it-works shows the last run with the classifier skipped");

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
  await mp.getByRole("button", { name: /^Done/ }).click();
  await mp.getByRole("button", { name: "Back to Today" }).click();
  await mp.getByRole("button", { name: "Check in now" }).click();
  await mp.getByRole("button", { name: /Begin check/ }).click();
  await mp.locator("#response").fill(LINES.crisis);
  await mp.getByRole("button", { name: "Submit" }).click();
  await mp.getByText("Please talk to a person now.").waitFor();
  await mshot("24-m-crisis", true);
  await mp.getByRole("button", { name: "Return to Today" }).click();
  await mp.locator(".tabbar").getByRole("link", { name: "How" }).click();
  await mp.getByText("skipped · not called").first().waitFor();
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
