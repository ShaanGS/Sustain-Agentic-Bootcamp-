// Local Ollama classifier. Student text stays on this machine.
import type { Classifier } from "./types.js";
import { SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { callModel } from "./http.js";

export function ollamaClassifier(opts: { url: string; model: string; timeoutMs: number; fetchImpl?: typeof fetch }): Classifier {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    info: { provider: "ollama", model: opts.model, sends_text_off_machine: false, destination: `${opts.url} (local Ollama)` },
    async classify(text) {
      const t0 = Date.now();
      const v = await callModel(
        opts.timeoutMs,
        (signal) => doFetch(`${opts.url.replace(/\/$/, "")}/api/chat`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            stream: false,
            format: "json",
            options: { temperature: 0 },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userMessage(text) },
            ],
          }),
        }),
        (body) => body.message.content,
      );
      return { source: "ollama", ms: Date.now() - t0, ...v };
    },
  };
}
