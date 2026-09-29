// Minimal logger. Accepts only an event code plus primitive fields.
// Callers must never pass student text; request bodies are never logged anywhere.
type Field = string | number | boolean | null | undefined;

let sink: (line: string) => void = (line) => console.log(line);
export const setLogSink = (fn: (line: string) => void) => { sink = fn; };

export function log(event: string, fields: Record<string, Field> = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  sink(`[still] ${new Date().toISOString()} ${event}${parts.length ? " " + parts.join(" ") : ""}`);
}
