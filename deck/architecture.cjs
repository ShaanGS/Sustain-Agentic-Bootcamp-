// Renders deck/still-architecture.{svg,png}: node deck/architecture.cjs (needs sharp)
const fs = require("fs"), path = require("path"), sharp = require("sharp");
const V = "#5B3CC4", D = "#2A1A66", L = "#F1EDFD", INK = "#1C1433", MUT = "#6E6887", LIL = "#B9A8F2";
const W = 220, H = 190, Y = 280, X = (i) => 40 + i * 270;
const nodes = [
  ["Trigger", "", "server scheduler", "or “Check in now”", 0],
  ["Student", "response", "one short answer", "never stored", 0],
  ["Safety", "backstop", "78 reviewed phrases", "local · no network", 1],
  ["LLM", "understanding", "risk + need + context", "failure → UNCERTAIN", 1],
  ["Policy", "engine", "server table decides", "model can't pick tools", 1],
  ["Allowlisted", "executor", "5 fixed actions", "server-set limits", 1],
  ["End", "", "check-in closes", "no endless chat", 0],
];
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="Arial" font-size="${o.size || 17}" font-weight="${o.bold ? 700 : 400}" fill="${o.fill || INK}" text-anchor="${o.anchor || "middle"}"${o.italic ? ' font-style="italic"' : ""}${o.ls ? ` letter-spacing="${o.ls}"` : ""}>${s}</text>`;
let g = "";
nodes.forEach(([a, b, c1, c2, strong], i) => {
  const x = X(i), cx = x + W / 2, fg = strong ? "#FFFFFF" : D, sub = strong ? "#E4DCFB" : MUT;
  g += `<rect x="${x}" y="${Y}" width="${W}" height="${H}" rx="28" fill="${strong ? V : L}"/>`;
  g += b ? t(cx, Y + 52, a, { size: 24, bold: 1, fill: fg }) + t(cx, Y + 82, b, { size: 24, bold: 1, fill: fg }) : t(cx, Y + 68, a, { size: 24, bold: 1, fill: fg });
  g += t(cx, Y + 128, c1, { fill: sub }) + t(cx, Y + 152, c2, { fill: sub });
  if (i < nodes.length - 1) g += `<line x1="${x + W + 6}" y1="${Y + H / 2}" x2="${x + 264}" y2="${Y + H / 2}" stroke="${LIL}" stroke-width="3" marker-end="url(#a)"/>`;
});
// Human help (terminal)
g += `<rect x="1180" y="660" width="500" height="170" rx="28" fill="${D}"/>`;
g += t(1430, 710, "Human help", { size: 26, bold: 1, fill: "#FFFFFF" });
g += t(1430, 748, "Tele-MANAS 14416 · Emergency 112 (first for danger)", { fill: "#E4DCFB" });
g += t(1430, 776, "verified static config — never model-written", { fill: "#E4DCFB" });
g += t(1430, 804, "no skill runs · check-in ends", { fill: "#E4DCFB" });
// Policy → Help (HIGH_RISK)
g += `<path d="M1265 470 V650" stroke="${D}" stroke-width="3" fill="none" marker-end="url(#ad)"/>`;
g += t(1280, 560, "HIGH_RISK", { bold: 1, fill: D, anchor: "start" });
// Safety → Help (explicit phrase, model not called)
g += `<path d="M610 470 V930 H1600 V840" stroke="${D}" stroke-width="3" fill="none" marker-end="url(#ad)"/>`;
g += t(1140, 920, "explicit crisis phrase → straight to help · the model is never called", { bold: 1, fill: D });
// Clarification loop
g += `<rect x="770" y="630" width="370" height="150" rx="28" fill="#FFFFFF" stroke="${V}" stroke-width="3"/>`;
g += t(955, 675, "One clarification", { size: 22, bold: 1, fill: V });
g += t(955, 708, "student taps the closest need");
g += t(955, 734, "can never downgrade risk");
g += t(955, 760, "(sealed hold, 15 min, not stored)", { fill: MUT, size: 15 });
g += `<path d="M1180 470 L1075 626" stroke="${V}" stroke-width="3" fill="none" marker-end="url(#av)"/>`;
g += t(1150, 592, "UNCERTAIN", { bold: 1, fill: V, anchor: "start" });
g += `<path d="M830 630 L930 474" stroke="${V}" stroke-width="3" stroke-dasharray="8 7" fill="none" marker-end="url(#av)"/>`;
g += t(626, 585, "re-check the original", { fill: V, anchor: "start", bold: 1 });
g += t(626, 607, "(safety + model again)", { fill: V, anchor: "start" });
// SAFE label on policy → executor
g += t(1375, 505, "SAFE", { bold: 1, fill: V, size: 15 });
// Executors list
g += t(1500, 530, "Focus timer · Breathing guide · Guided reset", { fill: MUT, size: 16 });
g += t(1500, 554, "Copy message · Acknowledge", { fill: MUT, size: 16 });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
${[["a", LIL], ["ad", D], ["av", V]].map(([id, c]) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="${c}"/></marker>`).join("")}
<radialGradient id="o" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#C9B8FF" stop-opacity=".8"/><stop offset="1" stop-color="#F1EDFD" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1920" height="1080" fill="#FFFFFF"/>
<circle cx="1800" cy="60" r="330" fill="url(#o)"/>
${t(40, 80, "ARCHITECTURE", { size: 18, bold: 1, fill: V, anchor: "start", ls: 5 })}
${t(40, 150, "Still. — the agent, without the black box", { size: 52, bold: 1, anchor: "start" })}
${t(40, 200, "One pass per check-in. Every arrow is enforced in server code, not in a prompt.", { size: 22, fill: MUT, anchor: "start" })}
${g}
<text x="40" y="1030" font-family="Arial" font-size="34" font-weight="700" fill="${INK}">THE MODEL <tspan fill="${V}">INTERPRETS.</tspan> THE POLICY <tspan fill="${V}">DECIDES.</tspan> THE EXECUTOR <tspan fill="${V}">ACTS.</tspan></text>
</svg>`;
const out = path.join(__dirname, "still-architecture");
fs.writeFileSync(out + ".svg", svg);
sharp(Buffer.from(svg), { density: 144 }).resize(3840, 2160).png().toFile(out + ".png").then(() => console.log("ok"));
