import type { Env } from "../../config.js";
import type { Classifier } from "./types.js";
import { groqClassifier } from "./groq.js";
import { ollamaClassifier } from "./ollama.js";
import { localClassifier } from "./local.js";

export function makeClassifier(env: Env): Classifier {
  switch (env.provider) {
    case "groq": return groqClassifier({ apiKey: env.groqApiKey, model: env.groqModel, timeoutMs: env.classifierTimeoutMs });
    case "ollama": return ollamaClassifier({ url: env.ollamaUrl, model: env.ollamaModel, timeoutMs: env.classifierTimeoutMs });
    case "local": return localClassifier();
  }
}
export type { Classifier, ClassifyResult, ClassifierInfo } from "./types.js";
