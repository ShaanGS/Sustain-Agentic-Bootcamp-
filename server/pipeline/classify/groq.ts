// Groq (OpenAI-compatible) classifier. Student text is sent to api.groq.com.
// Groq retires models (llama-3.1-8b-instant went on 16 Aug 2026), so a missing or rejected model
// falls through to the next one in a short chain instead of failing every check-in.
import type { Classifier } from "./types.js";
import { SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { callModel, type Timed } from "./http.js";
import { elapsed, mark } from "../../timing.js";
import { log } from "../../log.js";

export const GROQ_FALLBACK_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b"];

const isReasoning = (m: string) => m.startsWith("openai/gpt-oss") || m.startsWith("qwen/");
const extras = (m: string): Record<string, unknown> =>
  m.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : m.startsWith("qwen/") ? { reasoning_format: "hidden" } : {};

export function groqClassifier(opts: { apiKey: string; model: string; timeoutMs: number; fetchImpl?: typeof fetch }): Classifier {
  const doFetch = opts.fetchImpl ?? fetch;
  const models = [...new Set([opts.model, ...GROQ_FALLBACK_MODELS].filter(Boolean))];
  return {
    info: { provider: "groq", model: opts.model, sends_text_off_machine: true, destination: "api.groq.com (Groq Cloud)" },
    async classify(text) {
      const t0 = mark();
      if (!opts.apiKey) return { source: "groq", ms: 0, ok: false, reason: "missing_api_key" };
      let last: Timed = { ok: false, reason: "no_model" };
      for (const model of models) {
        // First the full request (JSON mode + model options), then a plain one if the model rejects a parameter.
        for (const plain of [false, true]) {
          const remaining = opts.timeoutMs - elapsed(t0);
          if (remaining < 250) return { source: "groq", ms: elapsed(t0), ok: false, reason: "timeout" };
          last = await callModel(
            remaining,
            (signal) => doFetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              signal,
              headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
              body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: isReasoning(model) ? 800 : 160,
                ...(plain ? {} : { response_format: { type: "json_object" }, ...extras(model) }),
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: userMessage(text) },
                ],
              }),
            }),
            (body) => body.choices[0].message.content,
          );
          if (last.ok || (last.reason !== "http_400" && last.reason !== "http_404")) {
            const total = elapsed(t0);
            return { source: "groq", model, ms: Math.round((total - (last.validate_ms ?? 0)) * 100) / 100, ...last };
          }
          log("classifier.retry", { model, reason: last.reason, plain });
          if (last.reason === "http_404") break; // model gone: no point retrying it without options
        }
      }
      return { source: "groq", ms: elapsed(t0), ...last };
    },
  };
}
