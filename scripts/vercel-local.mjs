// Serve the Vercel build output (.vercel/output) locally with Vercel's routing, to check a deploy
// before pushing:  npm run vercel-build && node scripts/vercel-local.mjs
// /api/* → the bundled function (no scheduler timer: it ticks per request, as on Vercel); else static, else index.html.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

process.env.VERCEL ??= "1";
const { default: handler } = await import(new URL("../.vercel/output/functions/api.func/index.mjs", import.meta.url).href);
const STATIC = new URL("../.vercel/output/static/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT) || 3000;

createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://local");
  const m = u.pathname.match(/^\/api\/(.*)$/);
  if (m) {
    u.searchParams.set("__path", m[1]);
    req.url = `/api?${u.searchParams}`;
    return handler(req, res);
  }
  let file = join(STATIC, normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, "index.html");
  res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`[vercel-local] http://localhost:${port}`));
