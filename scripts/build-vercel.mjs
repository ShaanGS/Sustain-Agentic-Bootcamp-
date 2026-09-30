// Vercel build (Build Output API v3). No framework preset needed:
//   static/            ← the Vite build of web/
//   functions/api.func ← server/vercel.ts bundled into one ESM file (Express app, Postgres/SQLite store)
// Routes: /api/* → the function (original path carried in __path), then static files, then SPA fallback.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });

// Editorial images: pull them into web/public/img/ so the deploy serves its own copies (non-fatal).
try { execSync("node scripts/fetch-images.mjs", { stdio: "inherit" }); } catch { console.log("images: skipped"); }
execSync("npx vite build --config web/vite.config.ts", { stdio: "inherit" });
cpSync("web/dist", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["server/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  logLevel: "info",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  maxDuration: 30,
}, null, 2));

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: "^/api/(.*)$", dest: "/api?__path=$1" },
    { handle: "filesystem" },
    { src: "^/(.*)$", dest: "/index.html" },
  ],
}, null, 2));

console.log(`\n✓ Vercel output written to ${out}`);
