import { readEnv } from "./config.js";
import { openStore } from "./store.js";
import { createApp } from "./app.js";
import { startScheduler } from "./scheduler.js";
import { makeClassifier } from "./pipeline/classify/index.js";
import { log } from "./log.js";

try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const env = readEnv();
const db = await openStore({ databaseUrl: env.databaseUrl, dbPath: env.dbPath });
const classifier = makeClassifier(env);
startScheduler(db, env.schedulerTickMs);
createApp({ db, classifier, tickMs: env.schedulerTickMs }).listen(env.port, () => {
  log("server.listening", { port: env.port, storage: db.kind, classifier: `${classifier.info.provider}/${classifier.info.model}`, tick_ms: env.schedulerTickMs });
  if (env.provider === "groq" && !env.groqApiKey) {
    log("config.warning", { msg: "CLASSIFIER_PROVIDER=groq but GROQ_API_KEY is empty; every response will go to clarification" });
  }
});
