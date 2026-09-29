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
  // 1. First run → set schedule (first due in 1 minute, fired by the real server scheduler)
  await page.goto(BASE);
  await expectText("When should Still");
  await shot("01-first-run");
  await page.locator("input[type=time]").fill("18:30");
  await page.getByLabel("Make the first check-in due in 1 minute").check();
  await page.getByRole("button", { name: "Set check-in" }).click();
  await expectText("Next check-in");
  await shot("02-home-scheduled");
  log("schedule saved; waiting for the server scheduler to fire…");

  // 2. The scheduler makes it ready
  await expectText("Ready now", 90_000);
  await shot("03-home-ready");
  log("scheduler created the check-in");

  // 3. Ordinary path #1
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await expectText("What's taking up the most space");
  await shot("04-prompt-empty");
  await page.locator("#response").fill(LINES.ordinary1);
  await shot("05-prompt-filled");
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("One next step");
  await expectText("Prioritize");
  await shot("06-result-prioritize");
  await page.locator(".trace summary").click();
  await shot("06b-result-trace-open");
  await page.getByRole("button", { name: "Done" }).click();
  await expectText("That's it for");
  await shot("07-done");
  await page.getByRole("button", { name: "Return home" }).click();
  log("ordinary #1 → Prioritize");

  // 4. Ordinary path #2 via "Check in now" (same creation path as the scheduler)
  await page.getByRole("button", { name: "Check in now" }).click();
  await expectText("Ready now");
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await page.locator("#response").fill(LINES.ordinary2);
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("Paced breathing");
  await shot("08-result-breathing");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Return home" }).click();
  log("ordinary #2 → Paced breathing");

  // 5. Unclear → clarify → one tap
  await page.getByRole("button", { name: "Check in now" }).click();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await page.locator("#response").fill(LINES.unclear);
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("Which feels");
  await shot("09-clarify");
  await page.getByRole("button", { name: /Can't get started/ }).click();
  await expectText("Ten-minute start");
  await shot("10-result-after-clarify");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Return home" }).click();
  log("unclear → clarify → Ten-minute start");

  // 6. Human support entry (quiet, from the shell)
  await page.getByRole("button", { name: "Human support" }).click();
  await expectText("free public lines");
  await shot("11-support-panel");
  await page.keyboard.press("Escape");

  // 7. Crisis → normal flow stops → human help
  await page.getByRole("button", { name: "Check in now" }).click();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await page.locator("#response").fill(LINES.crisis);
  await page.getByRole("button", { name: "Submit" }).click();
  await expectText("Please talk to a person now.");
  if (await page.locator(".steps, .skill-title").count()) throw new Error("a skill rendered on the crisis path");
  await shot("12-crisis-help");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const l of Object.values(LINES)) if (storage.includes(l.slice(0, 20))) throw new Error("response text found in browser storage");
  await page.getByRole("button", { name: "Return home" }).click();
  await expectText("Ended with human support");
  await shot("13-home-after-crisis");
  log("crisis → human help; browser storage holds no response text");

  // 8. Protocol, live
  await page.getByRole("link", { name: "Protocol" }).first().click();
  await expectText("Then it stops.");
  await expectText("SKIPPED · not called");
  await shot("14-protocol");
  await page.screenshot({ path: join(SHOTS, "15-protocol-full.png"), fullPage: true });
  log("protocol shows the last run with the classifier skipped");

  // 9. Phone width
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const mp = await m.newPage();
  await mp.goto(BASE);
  await mp.getByText("Next check-in").first().waitFor();
  await settle(mp);
  await mp.screenshot({ path: join(SHOTS, "20-mobile-home.png") });
  await mp.getByRole("button", { name: "Check in now" }).click();
  await mp.getByRole("button", { name: "Begin check-in" }).click();
  await mp.locator("#response").fill(LINES.ordinary1);
  await mp.screenshot({ path: join(SHOTS, "21-mobile-prompt.png") });
  await mp.getByRole("button", { name: "Submit" }).click();
  await mp.getByText("One next step").waitFor();
  await settle(mp);
  await mp.screenshot({ path: join(SHOTS, "22-mobile-result.png"), fullPage: true });
  await mp.getByRole("button", { name: "Done" }).click();
  await mp.getByRole("button", { name: "Return home" }).click();
  await mp.getByRole("button", { name: "Check in now" }).click();
  await mp.getByRole("button", { name: "Begin check-in" }).click();
  await mp.locator("#response").fill(LINES.crisis);
  await mp.getByRole("button", { name: "Submit" }).click();
  await mp.getByText("Please talk to a person now.").waitFor();
  await settle(mp);
  await mp.screenshot({ path: join(SHOTS, "23-mobile-help.png"), fullPage: true });
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
