// Test storage: SQLite by default; TEST_DB=pglite runs the same suite on real Postgres (in-process WASM).
import { openSqlite, openPostgresWith, type Store } from "../server/store.js";

export async function makeStore(path = ":memory:"): Promise<Store> {
  if (process.env.TEST_DB !== "pglite") return openSqlite(path);
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  return openPostgresWith(async (text, params) => {
    const r = await pg.query<Record<string, unknown>>(text, params as any[]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }, () => pg.close());
}
