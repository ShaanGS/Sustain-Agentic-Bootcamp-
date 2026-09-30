// Builds deck/Still-pitch.pptx — 6-slide judging deck.
// Run from a folder where pptxgenjs + sharp are installed:  node deck/build-deck.js
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const pptxgen = require("pptxgenjs");

const ROOT = path.resolve(__dirname, "..");
const A = path.join(__dirname, "assets");
fs.mkdirSync(A, { recursive: true });

// ---- design tokens (purple + white editorial system) ----
const C = {
  ink: "1C1433", deep: "2A1A66", violet: "5B3CC4", lilac: "B9A8F2",
  lav: "F1EDFD", lav2: "E4DCFB", muted: "6E6887", white: "FFFFFF",
};
const H = "Arial";   // headlines (bold)
const B = "Arial";   // body

// ---- gradient art (pptx has no native gradients → rendered PNGs) ----
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
async function art() {
  // Title: deep violet field with large soft circular forms.
  await sharp(svg(1920, 1080, `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E1250"/><stop offset=".55" stop-color="#3B24A0"/><stop offset="1" stop-color="#7A5CE0"/></linearGradient>
      <radialGradient id="o1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#D9CCFF" stop-opacity=".95"/><stop offset=".55" stop-color="#9C82F2" stop-opacity=".55"/><stop offset="1" stop-color="#6A4BD8" stop-opacity="0"/></radialGradient>
      <radialGradient id="o2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#B9A8F2" stop-opacity=".7"/><stop offset="1" stop-color="#B9A8F2" stop-opacity="0"/></radialGradient>
      <filter id="b"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
    <circle cx="1480" cy="430" r="520" fill="url(#o1)" filter="url(#b)"/>
    <circle cx="1720" cy="930" r="360" fill="url(#o2)"/>
    <circle cx="1480" cy="430" r="610" fill="none" stroke="#FFFFFF" stroke-opacity=".16" stroke-width="2"/>
    <circle cx="1480" cy="430" r="700" fill="none" stroke="#FFFFFF" stroke-opacity=".08" stroke-width="2"/>`)).png().toFile(`${A}/bg-title.png`);

  // Deep panel (slide 3 centre block, slide 5 left half).
  const deep = (w, h, cx, cy, r) => sharp(svg(w, h, `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#22145A"/><stop offset="1" stop-color="#4A2FB8"/></linearGradient>
      <radialGradient id="o" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#C8B8FF" stop-opacity=".75"/><stop offset=".6" stop-color="#8A6CF0" stop-opacity=".35"/><stop offset="1" stop-color="#8A6CF0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#o)"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 1.12}" fill="none" stroke="#FFFFFF" stroke-opacity=".14" stroke-width="2"/>`)).png();
  await deep(860, 920, 760, 120, 420).toFile(`${A}/panel-gap.png`);
  await deep(1240, 1440, 1150, 1330, 620).toFile(`${A}/panel-safety.png`);

  // Soft lavender orb for white slides.
  await sharp(svg(1200, 1200, `
    <defs><radialGradient id="o" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#C9B8FF" stop-opacity=".9"/><stop offset=".5" stop-color="#E4DCFB" stop-opacity=".7"/><stop offset="1" stop-color="#F1EDFD" stop-opacity="0"/></radialGradient></defs>
    <circle cx="600" cy="600" r="600" fill="url(#o)"/>`)).png().toFile(`${A}/orb.png`);

  // Slide 2 photo frame (3:4). Swap in the Magnific photo via right-click → Change Picture.
  await sharp(svg(1200, 1600, `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A2A7A"/><stop offset="1" stop-color="#8F78E6"/></linearGradient>
      <radialGradient id="o" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#E4DCFB" stop-opacity=".6"/><stop offset="1" stop-color="#E4DCFB" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1200" height="1600" fill="url(#g)"/>
    <circle cx="820" cy="560" r="520" fill="url(#o)"/>
    <text x="80" y="1480" font-family="Arial" font-size="40" fill="#FFFFFF" fill-opacity=".85">Photo: student at desk — right-click → Change Picture</text>`)).png().toFile(`${A}/photo-student.png`);

  // Slide 4: the real app — result screen with the focus timer running (e2e screenshot, cropped to the panel).
  await sharp(path.join(ROOT, "screenshots/06-focus-running.png"))
    .extract({ left: 670, top: 263, width: 2078, height: 1482 })
    .png().toFile(`${A}/app-result.png`);
  // Slide 6: the architecture diagram, cropped to the flow (no title / tagline — those stay native text).
  const archSvg = fs.readFileSync(path.join(__dirname, "still-architecture.svg"), "utf8").replace(/<circle cx="1800"[^>]*\/>/, "");
  await sharp(Buffer.from(archSvg), { density: 144 }).resize(3840, 2160)
    .extract({ left: 60, top: 540, width: 3780, height: 1360 })
    .png().toFile(`${A}/arch-diagram.png`);
}

// ---- helpers ----
const T = (s, text, o) => s.addText(text, { fontFace: B, color: C.ink, margin: 0, valign: "top", isTextBox: true, ...o });
const eyebrow = (s, text, x, y, color = C.violet, w = 6) =>
  T(s, text, { x, y, w, h: 0.3, fontSize: 11, bold: true, color, charSpacing: 3 });

async function build() {
  await art();
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  pres.title = "Still. — Sustain Agentic Bootcamp";

  // ================= 1 · TITLE =================
  {
    const s = pres.addSlide();
    s.background = { path: `${A}/bg-title.png` };
    T(s, "still.", { x: 0.75, y: 2.05, w: 8, h: 2.3, fontFace: H, fontSize: 170, bold: true, color: C.white, charSpacing: -4 });
    T(s, "A non-clinical check-in agent for students", { x: 0.8, y: 4.75, w: 7.5, h: 0.5, fontSize: 24, color: "E4DCFB" });
    T(s, [
      { text: "Sustain Agentic Bootcamp", options: { bold: true, breakLine: true } },
      { text: "Srishanth + Shaan  ·  September 30, 2026" },
    ], { x: 0.8, y: 6.2, w: 6.5, h: 0.7, fontSize: 13, color: C.white, lineSpacingMultiple: 1.25 });
    s.addNotes("Still. A bounded, non-clinical check-in agent for students. One question, one useful action, then it stops.");
  }

  // ================= 2 · THE PROBLEM =================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    s.addImage({ path: `${A}/photo-student.png`, x: 0, y: 0, w: 4.7, h: 7.5, sizing: { type: "cover", w: 4.7, h: 7.5 }, altText: "University student alone at a desk with a laptop and notes, late evening" });
    s.addImage({ path: `${A}/orb.png`, x: 10.4, y: -1.6, w: 4.2, h: 4.2, transparency: 20 });

    const X = 5.35;
    eyebrow(s, "THE PROBLEM, RIGHT NOW", X, 0.6);
    T(s, "Student wellbeing isn't an occasional problem.", { x: X, y: 0.95, w: 7.3, h: 1.2, fontFace: H, fontSize: 32, bold: true });

    T(s, "2.43 lakh+", { x: X, y: 2.35, w: 5.2, h: 1.05, fontFace: H, fontSize: 64, bold: true, color: C.violet, charSpacing: -2 });
    T(s, "higher-education students responded", { x: X + 0.05, y: 3.4, w: 3.7, h: 0.35, fontSize: 14, color: C.muted });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.2, y: 3.37, w: 3.3, h: 0.4, fill: { color: C.lav }, line: { color: C.lav }, rectRadius: 0.21 });
    T(s, "PRELIMINARY · NOT REPRESENTATIVE", { x: 9.2, y: 3.37, w: 3.3, h: 0.4, fontSize: 9, bold: true, color: C.violet, align: "center", valign: "middle", charSpacing: 1 });

    const stats = [
      ["15%", "felt very overwhelmed, distressed or low for weeks in the past 6 months"],
      ["9%", "had suicidal thoughts often or very often in the past year"],
      ["34%", "felt like an outsider on campus, to varying degrees"],
    ];
    stats.forEach(([n, l], i) => {
      const x = X + i * 2.5;
      T(s, n, { x, y: 4.2, w: 2.3, h: 0.95, fontFace: H, fontSize: 54, bold: true, color: C.deep, charSpacing: -2 });
      T(s, l, { x: x + 0.03, y: 5.2, w: 2.2, h: 0.95, fontSize: 12, color: C.ink, lineSpacingMultiple: 1.1 });
    });
    T(s, [
      { text: "~32% ", options: { bold: true, color: C.violet } },
      { text: "said their institution did not provide counselling services." },
    ], { x: X, y: 6.35, w: 7.4, h: 0.3, fontSize: 12 });
    T(s, "Preliminary, non-representative findings from the Supreme Court-appointed National Task Force survey, as reported on 29 Sep 2026 (The New Indian Express).",
      { x: X, y: 6.78, w: 7.4, h: 0.4, fontSize: 9.5, color: C.muted });
    s.addNotes("Source: newindianexpress.com, 29 Sep 2026 — 9% students reported suicidal thoughts, 34% felt like outsiders on campus: SC task force survey. Officials called the findings preliminary; the sample is not representative.");
  }

  // ================= 3 · THE GAP =================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    eyebrow(s, "THE GAP", 0.6, 0.55);
    T(s, "There is a gap between “talk” and “help”.", { x: 0.6, y: 0.9, w: 11, h: 0.8, fontFace: H, fontSize: 32, bold: true });

    const side = (x, tag, title, lines) => {
      s.addShape(pres.shapes.RECTANGLE, { x, y: 2.25, w: 3.55, h: 4.1, fill: { color: C.lav }, line: { color: C.lav } });
      T(s, tag, { x: x + 0.35, y: 2.6, w: 2.9, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 3 });
      T(s, title, { x: x + 0.35, y: 2.95, w: 2.95, h: 0.65, fontFace: H, fontSize: 30, bold: true, color: C.ink });
      T(s, lines.map((t, i) => ({ text: t, options: { breakLine: i < lines.length - 1 } })),
        { x: x + 0.35, y: 3.95, w: 2.9, h: 2.2, fontSize: 15, color: C.ink, paraSpaceAfter: 9 });
    };
    side(0.6, "EXTREME 1", "Chat forever", ["Open-ended AI conversations", "No clear endpoint", "No concrete action"]);
    side(9.18, "EXTREME 2", "Disappear", ["Reminders", "Resource pages", "Helpline links", "The next step is left to the student"]);

    // Still sits in the gap.
    s.addImage({ path: `${A}/panel-gap.png`, x: 4.4, y: 1.95, w: 4.53, h: 4.85 });
    T(s, "still.", { x: 4.8, y: 2.3, w: 3.8, h: 1.0, fontFace: H, fontSize: 58, bold: true, color: C.white, charSpacing: -2 });
    const pts = ["Short check-in", "Understands the situation", "Takes ONE useful action", "Knows when to stop"];
    T(s, pts.map((t, i) => ({ text: t, options: { breakLine: i < pts.length - 1 } })),
      { x: 4.85, y: 3.55, w: 3.7, h: 1.9, fontSize: 17, bold: true, color: C.white, paraSpaceAfter: 8 });
    T(s, "Not a therapist.\nNot a silent void.", { x: 4.85, y: 5.65, w: 3.8, h: 0.85, fontSize: 16, italic: true, color: "D9CCFF", lineSpacingMultiple: 1.1 });
    T(s, "Chat forever or disappear. Still sits in the gap.", { x: 0.6, y: 6.98, w: 12.1, h: 0.35, fontSize: 13, color: C.muted, align: "center" });
    s.addNotes("Two extremes today: talk to an AI indefinitely, or get a link and be left alone with the next step. Still is the middle: short, bounded, one action, then it stops.");
  }

  // ================= 4 · THE SOLUTION =================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    eyebrow(s, "THE SOLUTION", 0.6, 0.55);
    T(s, "Still. does one thing differently.", { x: 0.6, y: 0.9, w: 11, h: 0.8, fontFace: H, fontSize: 32, bold: true });

    s.addImage({ path: `${A}/orb.png`, x: -1.2, y: 2.4, w: 5.6, h: 5.6, transparency: 10 });
    s.addImage({ path: `${A}/app-result.png`, x: 0.6, y: 1.95, w: 6.95, h: 4.96,
      shadow: { type: "outer", color: "2A1A66", opacity: 0.18, blur: 18, offset: 4, angle: 90 }, altText: "Still app: Prioritize skill with a 15-minute focus timer running" });
    T(s, "The live app: “three assignments due this week” → Prioritize → 15-minute focus, running.",
      { x: 0.6, y: 7.0, w: 6.95, h: 0.3, fontSize: 10, color: C.muted });

    const X = 8.1, W = 4.65;
    const loop = [
      ["ASK", "One short scheduled check-in."],
      ["UNDERSTAND", "Model reads situation + need."],
      ["DECIDE", "Server policy picks an approved action."],
      ["ACT", "A real, bounded action runs."],
      ["STOP", "No endless chat."],
    ];
    s.addShape(pres.shapes.LINE, { x: X + 0.09, y: 2.12, w: 0, h: 2.0, line: { color: C.lav2, width: 1.5 } });
    loop.forEach(([k, v], i) => {
      const y = 1.97 + i * 0.5;
      s.addShape(pres.shapes.OVAL, { x: X, y: y + 0.06, w: 0.18, h: 0.18, fill: { color: i === 4 ? C.deep : C.violet }, line: { color: C.white, width: 1 } });
      T(s, [
        { text: k + "  ", options: { bold: true, color: C.violet, charSpacing: 1 } },
        { text: v, options: { color: C.ink } },
      ], { x: X + 0.35, y, w: W - 0.35, h: 0.32, fontSize: 13 });
    });

    eyebrow(s, "WHAT IT DOES", X, 4.75, C.muted, W);
    const ex = [
      ["“Three assignments due this week…”", "15-minute focus timer"],
      ["“Wound up about tomorrow's presentation…”", "60-second breathing guide"],
      ["“I feel very alone right now…”", "reviewed message, ready to copy"],
      ["Crisis phrase", "verified helpline · flow stops · model not called"],
    ];
    ex.forEach(([q, a], i) => {
      const y = 5.1 + i * 0.47;
      T(s, [
        { text: q, options: { color: i === 3 ? C.deep : C.ink, bold: i === 3, breakLine: true } },
        { text: "→ " + a, options: { color: C.violet, bold: true } },
      ], { x: X, y, w: W, h: 0.46, fontSize: 11 });
    });
    s.addNotes("Show the live app. ASK, UNDERSTAND, DECIDE, ACT, STOP. The model understands; the server decides; one allowlisted executor acts. Crisis language never reaches the model.");
  }

  // ================= 5 · SAFETY + SMART =================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    s.addImage({ path: `${A}/panel-safety.png`, x: 0, y: 0, w: 6.45, h: 7.5 });
    T(s, "Built around a clear protocol", { x: 0.6, y: 0.6, w: 5.4, h: 1.1, fontFace: H, fontSize: 32, bold: true, color: C.white });
    eyebrow(s, "SAFETY", 0.6, 1.95, C.lilac);
    const rows = [
      ["Explicit crisis phrases", "caught before the model is called"],
      ["Model risk", "SAFE / HIGH_RISK / UNCERTAIN"],
      ["UNCERTAIN", "never becomes a safe action"],
      ["HIGH_RISK", "human help · verified public helpline"],
    ];
    rows.forEach(([a, b], i) => {
      const y = 2.35 + i * 0.78;
      T(s, [
        { text: a, options: { bold: true, color: C.white, breakLine: true } },
        { text: "→ " + b, options: { color: "D9CCFF" } },
      ], { x: 0.6, y, w: 5.4, h: 0.7, fontSize: 15, lineSpacingMultiple: 1.1 });
    });
    T(s, "The safety system is an execution boundary, not just a prompt instruction.",
      { x: 0.6, y: 5.75, w: 5.3, h: 1.1, fontFace: H, fontSize: 19, bold: true, color: C.white, lineSpacingMultiple: 1.1 });

    const X = 7.05;
    eyebrow(s, "SMART GOALS", X, 0.7);
    const smart = [
      ["S", "Specific", "Scheduled, non-clinical student check-ins"],
      ["M", "Measurable", "One action per check-in · explicit crisis always escalates"],
      ["A", "Achievable", "Reviewed skills + deterministic safety backstop"],
      ["R", "Relevant", "Low-friction support for everyday student moments"],
      ["T", "Time-bound", "Validate normal + crisis paths in the live demo"],
    ];
    smart.forEach(([l, w, d], i) => {
      const y = 1.2 + i * 1.18;
      T(s, l, { x: X, y: y - 0.08, w: 0.8, h: 0.85, fontFace: H, fontSize: 44, bold: true, color: C.violet });
      T(s, w, { x: X + 0.95, y, w: 4.7, h: 0.35, fontSize: 16, bold: true });
      T(s, d, { x: X + 0.95, y: y + 0.38, w: 4.75, h: 0.6, fontSize: 13, color: C.muted });
    });
    s.addNotes("Safety is enforced in code, in this order: phrase backstop, model risk, server policy. UNCERTAIN can only lead to one clarification, and the original response is re-checked.");
  }

  // ================= 6 · ARCHITECTURE =================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    eyebrow(s, "ARCHITECTURE", 0.6, 0.55);
    T(s, "The agent, without the black box", { x: 0.6, y: 0.9, w: 11, h: 0.8, fontFace: H, fontSize: 32, bold: true });

    // The architecture diagram (deck/still-architecture.png, cropped to the diagram itself).
    s.addImage({ path: `${A}/arch-diagram.png`, x: 0.6, y: 1.7, w: 12.2, h: 4.39,
      altText: "Still architecture: trigger, student response, safety backstop, LLM understanding, policy engine, allowlisted executor, end; crisis phrase and HIGH_RISK go to human help; UNCERTAIN goes to one clarification that re-checks the original" });

    T(s, [
      { text: "THE MODEL ", options: { color: C.ink } }, { text: "INTERPRETS. ", options: { color: C.violet } },
      { text: "THE POLICY ", options: { color: C.ink } }, { text: "DECIDES. ", options: { color: C.violet } },
      { text: "THE EXECUTOR ", options: { color: C.ink } }, { text: "ACTS.", options: { color: C.violet } },
    ], { x: 0.6, y: 6.2, w: 12.2, h: 0.5, fontFace: H, fontSize: 23, bold: true });

    T(s, "React 19 · TypeScript · Vite · Node.js 22 · Express · SQLite · Zod · Groq / Ollama · Vitest · Supertest · Playwright",
      { x: 0.6, y: 6.85, w: 12.1, h: 0.3, fontSize: 12, color: C.muted });
    s.addNotes("One pass per check-in, no loop back to the model. Everything the student can be shown — skills, steps, helplines — comes from reviewed configuration, never from the model.");
  }

  const out = path.join(__dirname, "Still-pitch.pptx");
  await pres.writeFile({ fileName: out });
  console.log("wrote", out);
}
build().catch((e) => { console.error(e); process.exit(1); });
