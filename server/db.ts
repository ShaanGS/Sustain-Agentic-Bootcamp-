// SQLite persistence. Stores the schedule and check-in *metadata* only.
// There is deliberately no column that could hold a student's free-text response.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schedule (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      cadence      TEXT    NOT NULL CHECK (cadence IN ('daily','weekdays')),
      time_local   TEXT    NOT NULL,          -- "HH:MM" in the student's timezone
      timezone     TEXT    NOT NULL,          -- IANA name, e.g. Asia/Kolkata
      enabled      INTEGER NOT NULL DEFAULT 1,
      next_due_at  INTEGER,                   -- epoch ms; the scheduler fires when now >= this
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id                TEXT    PRIMARY KEY,
      source            TEXT    NOT NULL CHECK (source IN ('scheduled','manual')),
      status            TEXT    NOT NULL,
      created_at        INTEGER NOT NULL,
      due_at            INTEGER NOT NULL,
      expires_at        INTEGER NOT NULL,
      started_at        INTEGER,
      closed_at         INTEGER,
      token_hash        TEXT,                 -- sha256 of the single-use session token
      outcome           TEXT,                 -- skill | help | close_ok | none
      skill_id          TEXT,                 -- which reviewed skill was offered, if any
      classifier_source TEXT                  -- phrase | groq | ollama | local | failed | clarified
    );
    CREATE INDEX IF NOT EXISTS checkins_status ON checkins(status);
  `);
  return db;
}
