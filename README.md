# Still

A scheduled, non-clinical check-in steward for students — **PS #16, Sustainable Agentic AI bootcamp**.

Still is not a therapist, not a diagnosis system and not an open-ended companion. It runs one short
check-in, takes **one** bounded action, and stops. If a crisis phrase fires, the ordinary flow stops
and a verified public helpline is shown instead.

```
TRIGGER → OBSERVE → SAFETY → UNDERSTAND → DECIDE → ACT → END
 schedule   one short   explicit    model: risk,   server   one allowlisted   check-in
            response    backstop,   need, context  policy   executor runs     closes
                        then model
                          └─ HIGH_RISK ─→ STOP → HUMAN HELP (Tele-MANAS 14416 · 112) → END
```

Still is a **bounded decision-and-action agent**: it understands what's going on, chooses one permitted
intervention, actually runs it (a real focus timer, a guided breathing reset, a message ready to copy), then stops.
The model is never the authority, never writes advice, never produces a helpline and never picks a tool.

## Run it

```bash
npm install
cp .env.example .env        # pick a classifier (see below)
npm start                   # builds the UI, serves UI + API + scheduler on http://localhost:8787
npm run dev                 # development: API on :8787 + Vite UI on http://localhost:5173
npm test                    # 105 tests: pipeline, scheduler, API state machine, privacy
npm run eval                # fixture lines through the real pipeline
npm run build && npm run e2e  # full judge demo in headless Chromium, screenshots in ./screenshots
npm run test:pg             # the same 105 tests on real Postgres (in-process PGlite)
```

## Deploy on Vercel

The repo builds with the Vercel Build Output API. There is no framework preset: `npm run vercel-build` writes `.vercel/output`.

- `static/` holds the Vite UI.
- `functions/api.func` holds the Express API, bundled into a single Node 22 function.
- `/api/*` routes to the function, and every other path falls back to `index.html`.

1. Import the repo in Vercel. Set **Framework preset: Other**, **Build command: `npm run vercel-build`**, **Node 22.x**.
2. **Storage → Create → Neon (Postgres)**, then connect it to the project. This injects `DATABASE_URL`/`POSTGRES_URL`.
   Without it, Still falls back to SQLite in `/tmp`, which is per instance and resets when the instance is recycled. That's fine for a quick look but not for judging.
3. Set these environment variables:

   | Variable | Value |
   | --- | --- |
   | `STILL_SECRET` | Any long random string. It is the key that seals the one-clarification hold. |
   | `CLASSIFIER_PROVIDER` | `groq`, or `local` |
   | `GROQ_API_KEY` | Your key, when using Groq |

On serverless there is no background timer. The scheduler runs at the start of every API request instead, and the UI polls every 10s, so a due check-in still appears on its own. The claim is atomic: a conditional `UPDATE` on `next_due_at`, then a single `INSERT … WHERE NOT EXISTS (open)`. That means concurrent instances never duplicate a check-in.

To check a build locally before pushing:

```bash
npm run vercel-build && node scripts/vercel-local.mjs   # http://localhost:3000, same routing as Vercel
npm run vercel-build && E2E_VERCEL=1 npm run e2e        # the full judge demo against the build output
```

## Judge demo (about 5 minutes)

Open the app in one window and **How it works** (`/#/how`) in a second window beside it. It refreshes on its own, so every
step below appears there as a live agent trace: TRIGGER → OBSERVE → SAFETY → MODEL → UNDERSTAND → DECIDE → ACT → END.

1. **Schedule.** Set a time with *Make the first check-in due in 1 minute* on. The real server scheduler makes it ready.
2. **DEMO 1 — the agent acts.** Type: "I have three assignments due this week and keep jumping between all of them."
   - The screen shows *Safety ✓ Clear · Understand ✓ several tasks competing · Decide → Prioritize · Act 15-minute focus*.
   - It also shows "You mentioned three assignments due this week."
   - Press **Start 15-minute focus**. The timer really counts down, and the server records that the action started.
   - Press *I'm done*, then close.
3. **DEMO 2 — a different decision, a different action.** Type: "I'm wound up about tomorrow's presentation and can't settle."
   The result is *Paced breathing*. Press **Begin 60-second reset** for a guided, deterministic 4-in / 6-out breathing timer.
4. **More natural paths (optional).**
   - "I have my viva tomorrow morning and I haven't started… I keep opening Instagram" leads to *Start small*, a 10-minute focus on your viva prep.
   - "I feel lonely" leads to *Reach out*: **Copy message** copies a reviewed message to the clipboard. Still never sends it.
5. **DEMO 3 — explicit crisis.** Type: "I don't want to be here anymore. I want to end my life."
   - The backstop matches and the model is **not called** (it shows *Not called* in the trace).
   - The terminal human-help screen appears.
6. **DEMO 4 — the poisoning regression.** Type: "I ate poison with food."
   - This is an emergency backstop, so the screen reads *Get emergency help now* with **112 first**.
   - No skill, no clarification.
7. **DEMO 5 — model failure.** Run with `CLASSIFIER_PROVIDER=groq` and no key, or unplug the network.
   - The answer becomes UNCERTAIN and Still asks one *Which feels closest?* question. It never invents a skill.
8. **DEMO 6 — clarification can't downgrade risk.** The clarification step re-checks the **original** response
   (backstop plus model) before using the choice. This is covered by `tests/api.test.ts › DEMO 6`.

## UI

The layout follows the team's four visual references: an editorial landing layout, a journal app, a task planner and a dark job app.

- **Navigation:**
  - On desktop, a left nav: **Today · Schedule · How it works · Help**. A green dot next to Today means a check-in is ready.
  - On phones, the same four tabs sit in a bottom tab bar.
  - A "Talk to a person · 14416 · 112" pill is always in the header.
- **Today:** a big "YOUR NEXT CHECK-IN" headline, a tilted countdown stamp, and a dark card with a ring and the time. When the scheduler fires, the dark card becomes the green "Your check-in is ready" card with *Begin check-in*.
- **Check-in:** a focused panel with ✕, the question, a white answer field and a full-width *Submit*. Step chips track the journey: Prompt → Safety → Understand → One step → End.
- **One next step:** a journal-style entry with the skill photo, *Matched* and *Selected action* tiles, the three reviewed steps, and *Done* beside them. *Why this step* expands into the real server trace with measured timings.
- **Crisis:** replaces the whole app instantly with a warm **Tele-MANAS 14416** card and a dark **112** card, plus "Still has stopped this check-in and has not contacted anyone." Static content, no motion.
- **How it works:** a dark grid. The pipeline is drawn as six connected circles, each coloured by the last real run.
- **Images:** 8 editorial photos generated on Magnific. Run `npm run images` once on a machine with internet to save them into `web/public/img/`. Until then the app falls back to the Magnific URLs, which are signed and expire, and then to tinted placeholders.
- **Stack:** Vite, React and Motion. Urbanist and Geist Mono are self-hosted. Tokens live in `web/src/styles/tokens.css`.

## The agent loop

| Step | What happens | Authority |
| --- | --- | --- |
| **Trigger** | The server scheduler creates a due check-in. *Check in now* uses the same creation path. | `server/scheduler.ts` |
| **Observe** | One short response, with a valid single-use session token. The text is held in memory only. | server |
| **Safety 1** | Explicit backstop: 78 reviewed phrases in two categories, *self-harm* and *emergency* (poisoning, overdose, "not safe"). Local, with no network. A hit ends the flow **before any model call**. | `config/crisis-phrases.json` |
| **Safety 2 + Understand** | One model call returns strict JSON. It assesses `risk` first (`SAFE` / `HIGH_RISK` / `UNCERTAIN`), then gives one `need_id` and short `context`. The local fallback has its own danger lexicon, for example pills with "took", or "swallowed something". | Groq / Ollama / local rules |
| **Validate** | zod schema, need allowlist, and context limits (≤ 60 chars, no links, no advice). Context that echoes crisis language escalates to HIGH_RISK. A timeout, HTTP error, bad JSON, off-list need or malformed context becomes **UNCERTAIN, never SAFE**. | `server/pipeline/classify/schema.ts` |
| **Decide** | Server policy: HIGH_RISK goes to human help (terminal). SAFE goes need → one skill → one executor. UNCERTAIN goes to one tap-to-choose question, after which the **original response is re-checked** and a benign choice can never downgrade it. | `server/pipeline/policy.ts`, `config/needs.json` |
| **Act** | The skill's one allowlisted executor runs. The server records start and end (`POST /act`, idempotent). Type, duration and limits come from reviewed config. | `config/skills.json` |
| **End** | The check-in closes with an action result. Still does not continue the conversation. | server |

### What the model returns

```json
{ "risk": "SAFE", "need_id": "COMPETING_TASKS",
  "context": { "situation": "three assignments due Friday", "focus_target": null, "deadline": "Friday" } }
```

The model can escalate to human help but never de-escalate a backstop hit. It cannot choose a skill, an executor, a duration,
a URL or a tool. Any extra key, such as `"action": "send_email"`, fails validation.

### Executors: the only things Still can do

| Need | Skill | Executor | What it does |
| --- | --- | --- | --- |
| `COMPETING_TASKS` | Prioritize | `FOCUS_TIMER` 15 min | A real countdown on *the task due soonest* (or the target the student named) |
| `DIFFICULTY_STARTING` | Start small | `FOCUS_TIMER` 10 min | A real countdown on the named thing, for example *your viva prep* |
| `ACUTE_TENSION` | Paced breathing | `BREATHING_GUIDE` 60 s | Deterministic guide: 6 rounds of 4 s in and 6 s out |
| `FEELING_ISOLATED` | Reach out | `COPY_MESSAGE` | Copies one reviewed message to the clipboard. **Never sends anything.** |
| `SLEEP_OR_EXHAUSTION` | Wind down | `GUIDED_RESET` 2 min | Four reviewed cues, 30 s each |
| `DOING_OK` | Nothing to fix | `ACKNOWLEDGE` | Notes the check-in and closes |

No executor can reach the network, send messages, write files, touch a calendar or call any other tool. The client only
renders them; the server records `executor`, `action_started_at`, `action_ends_at` and `action_result`.

**Limits, stated honestly:** the explicit backstop is a phrase list, not a medical detector. The model safety layer covers
other phrasings but can also be wrong. That is why every uncertain or failed path fails closed.

## Classifier options

| `CLASSIFIER_PROVIDER` | Where the response text goes | Notes |
| --- | --- | --- |
| `local` (default) | Stays in-process | Deterministic keyword rules. Anything unclear becomes UNCERTAIN. |
| `groq` | Sent to `api.groq.com` for labelling | Free tier, `llama-3.1-8b-instant`. Groq's data policy applies. Without a key, every response goes to clarification. |
| `ollama` | Stays on the laptop | Free and local. Needs `ollama pull llama3.2:3b` first. |

Compare providers with `npm run eval -- --provider groq`.

## Scheduling

- The schedule (daily or weekdays, `HH:MM`, IANA timezone) is persisted in SQLite (Postgres on Vercel).
- A **server-side** scheduler ticks every 15s (on Vercel: at the start of every API request). When `now ≥ next_due_at` it creates a real `ready` check-in, then advances `next_due_at`. Missed slots, for example while the laptop is asleep, collapse into one check-in.
- "Check in now" calls the same `createDueCheckin()`.
- For a demo, `first_due_in_seconds` sets a real due time (for example, 60s out) that the scheduler then fires.
- Still sends **no notifications**. A due check-in shows up in the app.
- A ready check-in expires after 12h. An unfinished one is abandoned after 15 min.

## What is stored, and where

| Where | What | Free text? |
| --- | --- | --- |
| SQLite `data/still.db` (Postgres on Vercel) | Schedule. Per check-in: id, source, status, timestamps, outcome, skill id, **executor, action start/end, action result**, classifier source | **No.** There is no column for it. |
| Sealed clarification hold, clarification only | If one clarification is needed, the server encrypts the response with AES-256-GCM (key from `STILL_SECRET`, bound to this check-in id, 15 min expiry) and hands back the opaque blob. The page keeps it in memory only, never in browser storage. It returns it once with the choice so the original's safety is re-checked. A missing, tampered, expired or foreign hold offers **no** skill. | Encrypted, in page memory only. Never written to any DB, log or storage. |
| HTTP response to the student | Extracted `context`, for example "three assignments due this week", shown once | Never stored, logged or put in the trace |
| Server logs | Event codes and ids only. No request bodies, not even on JSON parse errors. | No |
| Browser | Only the opaque session token, in `sessionStorage`. No response text. | No |
| Agent trace (`agent_runs` table) | Last 20 check-ins as step codes and reviewed labels, pruned on write | No |
| Classifier provider | Only with `groq`: the text is sent for classification, and Groq's retention policy applies | Leaves the machine |

Wording used in the product: **"Your response isn't stored by Still."** The protocol view always discloses: **"When Groq is
active, your response is sent to Groq for classification."** No mental-health profile, history or analytics are kept.

`tests/api.test.ts › privacy` submits sentinel strings, including a crisis line, a clarification and a malformed body. It checks
they are absent from the DB file, WAL, logs, `/api/state` and `/api/protocol`, and that extracted context isn't stored either.

## Check-in state machine

```
(schedule) --tick / check-in-now--> ready --start--> in_progress
ready --> expired | skipped
in_progress --explicit phrase or HIGH_RISK--> help_shown                      (terminal)
in_progress --SAFE--> offered --act--> acting --close--> completed            (terminal)
offered --close (action not started)--> completed
in_progress --UNCERTAIN / model failed--> clarifying
clarifying --re-check original: HIGH_RISK--> help_shown
clarifying --pick one need--> offered ; --"talk to a person"--> help_shown
in_progress --15 min--> abandoned ; acting --10 min after it ends--> completed (timed_out)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Schedule, open check-in, last outcome, classifier info, helplines |
| `PUT` | `/api/schedule` | Body `{cadence, time_local, timezone, enabled?, first_due_in_seconds?}` |
| `POST` | `/api/checkins/now` | Create a due check-in (same path as the scheduler) |
| `POST` | `/api/checkins/:id/start` | `ready → in_progress`. Returns a single-use token and the prompt |
| `POST` | `/api/checkins/:id/respond` | Body `{token, text}`. Returns `route: skill \| clarify \| help`, plus a step trace with measured per-step `ms` and `total_ms` (no text). Steps that didn't run carry no time. |
| `POST` | `/api/checkins/:id/clarify` | Body `{token, choice: need_id \| "talk_to_person"}`. Re-checks the original response first |
| `POST` | `/api/checkins/:id/act` | Body `{token}`. Starts the attached executor (`offered → acting`). Idempotent |
| `POST` | `/api/checkins/:id/close` | Body `{token, action_result?}`. `offered \| clarifying \| acting → completed`. The result must be allowed for that executor |
| `POST` | `/api/checkins/:id/skip` | `ready → skipped` |
| `POST` | `/api/checkins/:id/resume` | From another tab: new session token for an **unanswered** check-in (the old tab's token stops working) |
| `POST` | `/api/checkins/:id/end` | From any tab: `in_progress → abandoned`, `offered \| clarifying → completed` |
| `GET` | `/api/protocol` | Everything the protocol screen shows, including recent runs as step codes only |

## Scope: what Still is not

Still is not a therapist, a diagnosis tool, a crisis-response service, a mood tracker, a surveillance tool or a
treatment system. Still never contacts anyone on the student's behalf.
