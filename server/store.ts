// Persistence. One small async interface over two backends:
//   • SQLite (node:sqlite) — local laptop runs and tests
//   • Postgres — Vercel (Neon over HTTP via DATABASE_URL / POSTGRES_URL)
// Both hold the schedule and check-in *metadata* only. There is deliberately no column that could
// hold a student's free-text response.

export interface Store {
  kind: "sqlite" | "postgres";
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

// Epoch-ms columns. Postgres BIGINT arrives as a string over the wire; normalise to number.
const NUMERIC = new Set([
  "created_at", "due_at", "expires_at", "started_at", "closed_at", "action_started_at", "action_ends_at",
  "next_due_at", "updated_at", "enabled", "at", "total_ms", "n",
]);
function normaliseRow<T>(row: Record<string, unknown>): T {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (NUMERIC.has(k) && typeof v === "string" && v !== "") row[k] = Number(v);
    else if (NUMERIC.has(k) && typeof v === "bigint") row[k] = Number(v);
  }
  return row as T;
}

const TABLES = (big: string, real: string) => [
  `CREATE TABLE IF NOT EXISTS schedule (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    cadence      TEXT    NOT NULL CHECK (cadence IN ('daily','weekdays')),
    time_local   TEXT    NOT NULL,
    timezone     TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    next_due_at  ${big},
    updated_at   ${big}  NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS checkins (
    id                TEXT PRIMARY KEY,
    source            TEXT NOT NULL CHECK (source IN ('scheduled','manual')),
    status            TEXT NOT NULL,
    created_at        ${big} NOT NULL,
    due_at            ${big} NOT NULL,
    expires_at        ${big} NOT NULL,
    started_at        ${big},
    closed_at         ${big},
    token_hash        TEXT,
    outcome           TEXT,
    skill_id          TEXT,
    classifier_source TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS checkins_status ON checkins(status)`,
  // Agent trace of recent check-ins: step codes and reviewed labels only — never text.
  `CREATE TABLE IF NOT EXISTS agent_runs (
    checkin  TEXT PRIMARY KEY,
    at       ${big} NOT NULL,
    steps    TEXT NOT NULL,
    outcome  TEXT NOT NULL,
    total_ms ${real} NOT NULL
  )`,
];
// Additive columns (older databases gain them on start).
const ADDED: [string, "big" | "text"][] = [
  ["executor", "text"], ["action_started_at", "big"], ["action_ends_at", "big"], ["action_result", "text"],
];

// ---------------------------------------------------------------- SQLite

export async function openSqlite(path: string): Promise<Store> {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") {
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  for (const t of TABLES("INTEGER", "REAL")) db.exec(t);
  const cols = new Set((db.prepare(`PRAGMA table_info(checkins)`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of ADDED) if (!cols.has(name)) db.exec(`ALTER TABLE checkins ADD COLUMN ${name} ${type === "big" ? "INTEGER" : "TEXT"}`);
  const p = (params: unknown[]) => params as (string | number | null)[];
  return {
    kind: "sqlite",
    async run(sql, params = []) { return { changes: Number(db.prepare(sql).run(...p(params)).changes) }; },
    async get<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).get(...p(params)) as T | undefined; },
    async all<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...p(params)) as T[]; },
    async close() { db.close(); },
  };
}

// ---------------------------------------------------------------- Postgres

export type PgQuery = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

/** `?` placeholders → `$1, $2, …` (our SQL never contains a literal `?`). */
const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export async function openPostgresWith(query: PgQuery, close: () => Promise<void> = async () => {}): Promise<Store> {
  for (const t of TABLES("BIGINT", "DOUBLE PRECISION")) await query(t, []);
  for (const [name, type] of ADDED) await query(`ALTER TABLE checkins ADD COLUMN IF NOT EXISTS ${name} ${type === "big" ? "BIGINT" : "TEXT"}`, []);
  return {
    kind: "postgres",
    async run(sql, params = []) { const r = await query(toPg(sql), params); return { changes: r.rowCount ?? 0 }; },
    async get<T>(sql: string, params: unknown[] = []) { const r = await query(toPg(sql), params); return r.rows[0] ? normaliseRow<T>(r.rows[0]) : undefined; },
    async all<T>(sql: string, params: unknown[] = []) { const r = await query(toPg(sql), params); return r.rows.map((x) => normaliseRow<T>(x)); },
    close,
  };
}

/** Neon serverless Postgres over HTTP — works inside short-lived Vercel functions. */
export async function openNeon(url: string): Promise<Store> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url, { fullResults: true });
  return openPostgresWith(async (text, params) => {
    const r = await sql.query(text, params as any[]);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
  });
}

export async function openStore(opts: { databaseUrl?: string; dbPath: string }): Promise<Store> {
  return opts.databaseUrl ? openNeon(opts.databaseUrl) : openSqlite(opts.dbPath);
}
