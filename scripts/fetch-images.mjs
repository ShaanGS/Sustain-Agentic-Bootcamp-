// Downloads Still's Magnific images into web/public/img/ (run once on a machine with internet).
// The signed Magnific URLs expire; if a download fails, re-export the image from Magnific
// and save it under the same file name.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const src = readFileSync(new URL("../web/src/lib/images.ts", import.meta.url), "utf8");
const entries = [...src.matchAll(/file: "([^"]+)"[\s\S]*?remote: "([^"]+)"/g)].map((m) => ({ file: m[1], url: m[2] }));
const out = new URL("../web/public/img/", import.meta.url);
mkdirSync(out, { recursive: true });

let ok = 0;
for (const { file, url } of entries) {
  const dest = new URL(file, out);
  if (existsSync(dest)) { console.log(`skip  ${file} (exists)`); ok++; continue; }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${file}`);
    ok++;
  } catch (e) {
    console.log(`FAIL  ${file}: ${e.message}`);
  }
}
console.log(`\n${ok}/${entries.length} images in web/public/img/`);
