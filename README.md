# Still

A scheduled, non-clinical check-in steward for students — **PS #16, Sustainable Agentic AI bootcamp**.

Still is not a therapist, not a diagnosis system and not an open-ended companion. It runs one short
check-in, takes **one** bounded action, and stops. If a crisis phrase fires, the ordinary flow stops
and a verified public helpline is shown instead.

```
SCHEDULE → READY → SHORT PROMPT → RESPONSE → SAFETY CHECK → UNDERSTAND → ONE ACTION → END
                                              └─ crisis ─→ STOP → HUMAN HELP (Tele-MANAS 14416 · 112) → END
```

## Run it

```bash
npm install
cp .env.example .env        # pick a classifier (see below)
npm start                   # builds the UI, serves UI + API + scheduler on http://localhost:8787
npm run dev                 # development: API on :8787 + Vite UI on http://localhost:5173
npm test                    # 60 tests: pipeline, scheduler, API state machine, privacy
npm run eval                # fixture lines through the real pipeline
npm run build && npm run e2e  # full judge demo in headless Chromium, screenshots in ./screenshots
```

## Judge demo (about 4 minutes)

Open the check-in in one window and **Protocol** (`/#/protocol`) in a second window beside it. The Protocol view
refreshes on its own, so each step below shows up there as a real run.

1. **Set a check-in.** On first run, pick a time, tick *Make the first check-in due in 1 minute*, then *Set check-in*.
   The home screen counts down to the real `next_due_at`.
2. **It becomes ready.** The server-side scheduler creates the check-in and the home screen switches to *Your check-in is ready*.
3. **Begin → answer:** "I have three assignments due this week and keep jumping between all of them."
4. **One next step: Prioritize.** The screen shows *Matched: too many things competing · Selected: Prioritize*.
   Open *How Still decided* to see the recorded trace with real per-step timings. Then *Done* → the check-in closes and shows the next time.
5. **Check in now** (same creation path as the scheduler) → "I'm really wound up about tomorrow's presentation and can't settle." → **Paced breathing**.
6. **Check in now** → "I don't want to be here anymore. I want to end my life."
   The ordinary flow stops. The full-screen human-help page shows **Tele-MANAS 14416** and **112**, and says Still has not contacted anyone.
7. **Protocol:** the last run shows `crisis_phrase HIT` and `classifier SKIPPED · not called`.

Optional beats:
- Type something vague ("idk") to see the one-tap clarification.
- Run with `CLASSIFIER_PROVIDER=groq` and no key to show that failure goes to clarification, never to a made-up skill.

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

## Protocol (one screen)

| Step | What happens | Authority |
| --- | --- | --- |
| 1. Session | The check-in must be open. The single-use session token must be valid (15-min window). | server |
| 2. Crisis phrase | Reviewed explicit phrase list, run locally with no network. A **hit stops everything** before any model call. | `config/crisis-phrases.json` |
| 3. Classify | Returns `ORDINARY` / `UNCERTAIN` / `CRISIS`, plus one `need_id` if ORDINARY. **It never writes advice.** | Groq / Ollama / local rules |
| 4. Validate | Output must match the schema and the needs allowlist. A timeout, error or invalid output becomes **UNCERTAIN, never ORDINARY**. | `zod` + allowlist |
| 5. Policy | CRISIS → human help. ORDINARY → the one skill mapped to that need. UNCERTAIN → one tap-to-choose clarification, which includes "I'd rather talk to a person". | `config/needs.json` |
| 6. Close | The check-in ends. There is no second free-text round. | server |

The phrase list is deliberately over-inclusive. Negations such as "I'm not going to kill myself" still route to
help; this is covered by the tests and the eval fixtures.

The model can escalate to help but can never de-escalate a phrase hit. The model never chooses a skill,
and never sees or produces a helpline number.

### Reviewed static config

| File | What it holds |
| --- | --- |
| `config/helplines.json` | Tele-MANAS **14416** / 1-800-891-4416 (MoHFW, free, 24×7) and Emergency **112**, each with its source URL and verification date |
| `config/skills.json` | 5 skills, plus a "nothing to fix today" close. Fixed copy, no diagnosis words, no treatment claims |
| `config/needs.json` | The policy table mapping need → skill |
| `config/crisis-phrases.json` | Explicit phrases. Deliberately over-inclusive: negations still route to help |
| `config/checkin.json` | The one prompt, the character limit and the time windows |

## Classifier options

| `CLASSIFIER_PROVIDER` | Where the response text goes | Notes |
| --- | --- | --- |
| `local` (default) | Stays in-process | Deterministic keyword rules. Anything unclear becomes UNCERTAIN. |
| `groq` | Sent to `api.groq.com` for labelling | Free tier, `llama-3.1-8b-instant`. Groq's data policy applies. Without a key, every response goes to clarification. |
| `ollama` | Stays on the laptop | Free and local. Needs `ollama pull llama3.2:3b` first. |

Compare providers with `npm run eval -- --provider groq`.

## Scheduling

- The schedule (daily or weekdays, `HH:MM`, IANA timezone) is persisted in SQLite.
- A **server-side** scheduler ticks every 15s. When `now ≥ next_due_at` it creates a real `ready` check-in, then advances `next_due_at`. Missed slots, for example while the laptop is asleep, collapse into one check-in.
- "Check in now" calls the same `createDueCheckin()`.
- For a demo, `first_due_in_seconds` sets a real due time (for example, 60s out) that the scheduler then fires.
- Still sends **no notifications**. A due check-in shows up in the app.
- A ready check-in expires after 12h. An unfinished one is abandoned after 15 min.

## What is stored, and where

| Where | What | Free text? |
| --- | --- | --- |
| SQLite `data/still.db` | Schedule. Per check-in: id, source, status, timestamps, outcome, skill id, classifier source | **No.** There is no column for it. |
| Server logs | Event codes and ids. No request bodies, not even on JSON parse errors. | No |
| Browser | No response text in local or session storage | No |
| Demo log | Last 20 pipeline step codes, in memory, cleared on restart | No |
| Classifier provider | Only when `groq` is selected: the text is sent for labelling and the provider's retention policy applies | Leaves the machine |

Wording used in the product: **"Your response isn't stored by Still."** Still never claims that nothing leaves
the machine. The protocol view always discloses: **"When Groq is active, your response is sent to Groq for classification."**

`tests/api.test.ts › privacy` submits sentinel strings, including a crisis line and a malformed body. It then
checks that they are absent from the DB file, WAL, logs, `/api/state` and `/api/protocol`.

## Check-in state machine

```
(schedule) --tick / check-in-now--> ready --start--> in_progress
ready --> expired | skipped
in_progress --crisis phrase or CRISIS--> help_shown            (terminal)
in_progress --ORDINARY--> offered --done--> completed          (terminal)
in_progress --UNCERTAIN / classifier failed--> clarifying
clarifying --pick one need--> offered ; --"talk to a person"--> help_shown
in_progress | clarifying | offered --15 min--> abandoned       (terminal)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Schedule, open check-in, last outcome, classifier info, helplines |
| `PUT` | `/api/schedule` | Body `{cadence, time_local, timezone, enabled?, first_due_in_seconds?}` |
| `POST` | `/api/checkins/now` | Create a due check-in (same path as the scheduler) |
| `POST` | `/api/checkins/:id/start` | `ready → in_progress`. Returns a single-use token and the prompt |
| `POST` | `/api/checkins/:id/respond` | Body `{token, text}`. Returns `route: skill \| clarify \| help`, plus a step trace with measured per-step `ms` and `total_ms` (no text). Steps that didn't run carry no time. |
| `POST` | `/api/checkins/:id/clarify` | Body `{token, choice: need_id \| "talk_to_person"}` |
| `POST` | `/api/checkins/:id/close` | `offered \| clarifying → completed` |
| `POST` | `/api/checkins/:id/skip` | `ready → skipped` |
| `POST` | `/api/checkins/:id/resume` | From another tab: new session token for an **unanswered** check-in (the old tab's token stops working) |
| `POST` | `/api/checkins/:id/end` | From any tab: `in_progress → abandoned`, `offered \| clarifying → completed` |
| `GET` | `/api/protocol` | Everything the protocol screen shows, including recent runs as step codes only |

## Scope: what Still is not

Still is not a therapist, a diagnosis tool, a crisis-response service, a mood tracker, a surveillance tool or a
treatment system. Still never contacts anyone on the student's behalf.
