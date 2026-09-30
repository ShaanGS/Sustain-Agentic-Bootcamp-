// Vercel serverless entry. One Express app per warm instance; storage is Postgres when
// DATABASE_URL / POSTGRES_URL is set (Neon via Vercel Storage), otherwise best-effort SQLite in /tmp.
// There is no long-lived timer on serverless: the scheduler runs at the start of every API request.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readEnv } from "./config.js";
import { openStore } from "./store.js";
import { createApp } from "./app.js";
import { makeClassifier } from "./pipeline/classify/index.js";
import { log } from "./log.js";

let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

function getApp() {
  appPromise ??= (async () => {
    const env = readEnv();
    const db = await openStore({ databaseUrl: env.databaseUrl, dbPath: env.dbPath });
    const classifier = makeClassifier(env);
    log("function.ready", { storage: db.kind, classifier: `${classifier.info.provider}/${classifier.info.model}` });
    if (db.kind === "sqlite") log("config.warning", { msg: "no DATABASE_URL — using /tmp SQLite; state resets when the instance is recycled" });
    return createApp({ db, classifier, tickOnRequest: true });
  })().catch((e) => { appPromise = null; throw e; });
  return appPromise;
}

export default async function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  // Routes rewrite /api/<path> → /api?__path=<path>; restore the original path for Express.
  const u = new URL(req.url ?? "/", "http://still.local");
  const p = u.searchParams.get("__path");
  if (p !== null) { u.searchParams.delete("__path"); req.url = `/api/${p}${u.search}`; }
  try {
    const app = await getApp();
    (app as unknown as (q: IncomingMessage, s: ServerResponse) => void)(req, res);
  } catch (e) {
    log("function.error", { name: (e as Error).name });
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "server_unavailable" }));
  }
}
