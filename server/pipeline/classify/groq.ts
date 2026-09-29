// Groq (OpenAI-compatible) classifier. Student text is sent to api.groq.com.
import type { Classifier } from "./types.js";
import { SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { callModel } from "./http.js";
import { elapsed, mark } from "../../timing.js";

export function groqClassifier(opts: { apiKey: string; model: string; timeoutMs: number; fetchImpl?: typeof fetch }): Classifier {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    info: { provider: "groq", model: opts.model, sends_text_off_machine: true, destination: "api.groq.com (Groq Cloud)" },
    async classify(text) {
      const t0 = mark();
      if (!opts.apiKey) return { source: "groq", ms: 0, ok: false, reason: "missing_api_key" };
      const v = await callModel(
        opts.timeoutMs,
        (signal) => doFetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model: opts.model,
            temperature: 0,
            max_tokens: 60,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userMessage(text) },
            ],
          }),
        }),
        (body) => body.choices[0].message.content,
      );
      const total = elapsed(t0);
      return { source: "groq", ms: Math.round((total - (v.validate_ms ?? 0)) * 100) / 100, ...v };
    },
  };
}
