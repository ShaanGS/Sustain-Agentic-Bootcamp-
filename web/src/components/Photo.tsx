import { useState } from "react";
import { IMAGES, type ImageName } from "../lib/images";

/** Local file first (npm run images), then the Magnific URL, then a tinted placeholder. */
export function Photo({ name, className = "" }: { name: ImageName | string; className?: string }) {
  const def = (IMAGES as Record<string, (typeof IMAGES)[ImageName]>)[name];
  const [stage, setStage] = useState<0 | 1 | 2>(def ? 0 : 2);
  if (!def || stage === 2) return <div className={`photo-fallback ${className}`} style={{ ["--tint" as string]: def?.tint }} aria-hidden />;
  const src = stage === 0 ? `/img/${def.file}` : def.remote;
  return <img className={`photo ${className}`} src={src} alt={def.alt} aria-hidden={def.alt ? undefined : true} loading="lazy"
    onError={() => setStage((s) => (s === 0 ? 1 : 2))} />;
}
