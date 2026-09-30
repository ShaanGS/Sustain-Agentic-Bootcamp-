import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { api, ApiError, type RouteResult, type StartResult } from "./lib/api";
import { useAppState } from "./lib/useLive";
import { clearSession, loadSession, saveSession } from "./lib/session";
import { Shell, TAB_HREF, type Tab } from "./components/Shell";
import { SkillsCarousel } from "./components/SkillsCarousel";
import { Today, TodaySide } from "./screens/Today";
import { Schedule, ScheduleSide } from "./screens/Schedule";
import { PromptPanel, ResultPanel, ClarifyPanel, DonePanel, type RunState } from "./screens/Flow";
import { Crisis, HelpTab } from "./screens/Help";
import { How, useProtocol } from "./screens/How";

type Skill = Extract<RouteResult, { route: "skill" }>;
type Clar = Extract<RouteResult, { route: "clarify" }>;
type HelpR = Extract<RouteResult, { route: "help" }>;

/** Client view of the server state machine. Each variant is entered only from a real API response. */
type Flow =
  | { kind: "home" }
  | { kind: "prompt"; id: string; start: StartResult; submitting: boolean; error: string | null; scope?: boolean }
  | { kind: "result"; id: string; token: string; result: Skill; via: "classifier" | "clarify"; closing: boolean; run: RunState }
  | { kind: "clarify"; id: string; token: string; result: Clar; busy: boolean }
  | { kind: "help"; result: HelpR }
  | { kind: "done"; step: { id: string; title: string; action?: string; result?: string | null } | null };

function useTab(): Tab {
  const get = (): Tab => {
    const h = location.hash;
    if (h.startsWith("#/schedule")) return "schedule";
    if (h.startsWith("#/how") || h.startsWith("#/protocol")) return "how";
    if (h.startsWith("#/help")) return "help";
    return "today";
  };
  const [tab, setTab] = useState(get);
  useEffect(() => {
    const f = () => { setTab(get()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return tab;
}

export function App() {
  const tab = useTab();
  const { state, offline, refresh } = useAppState(tab === "today" ? 3000 : 8000);
  const protocol = useProtocol(tab === "how" ? 2500 : 30000);
  const [flow, setFlow] = useState<Flow>({ kind: "home" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The response lives only here, in memory, while its request is in flight.
  const pendingText = useRef("");

  const goToday = useCallback((msg?: string) => {
    setFlow({ kind: "home" });
    setNotice(msg ?? null);
    refresh();
    if (location.hash && location.hash !== "#/") location.hash = "#/";
  }, [refresh]);

  const lost = useCallback((e: unknown) => {
    clearSession();
    pendingText.current = "";
    if (e instanceof ApiError && e.status === 0) return goToday("Can't reach Still's server. Nothing changed on the server.");
    goToday("This check-in closed before it finished. You can start a new one any time.");
  }, [goToday]);

  // ---- actions: each one is a real endpoint ----
  const checkInNow = async () => {
    setBusy(true); setNotice(null);
    try { await api.checkInNow(); await refresh(); } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const begin = async (id: string) => {
    setBusy(true); setNotice(null);
    try {
      const start = await api.start(id);
      saveSession({ id, start });
      setFlow({ kind: "prompt", id, start, submitting: false, error: null });
    } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const skip = async (id: string) => {
    setBusy(true);
    try { await api.skip(id); goToday("Skipped. Still will check in again at your next scheduled time."); } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const resume = () => {
    const s = loadSession();
    if (s) setFlow({ kind: "prompt", id: s.id, start: s.start, submitting: false, error: null });
  };
  const finish = async () => {
    const s = loadSession();
    if (!s) return;
    try { await api.close(s.id, s.start.token); clearSession(); await refresh(); setFlow({ kind: "done", step: null }); } catch (e) { lost(e); }
  };
  // Another tab holds the session token: take the check-in over here, or end it.
  const takeOver = async (id: string) => {
    setBusy(true); setNotice(null);
    try {
      const start = await api.resume(id);
      saveSession({ id, start });
      setFlow({ kind: "prompt", id, start, submitting: false, error: null });
    } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const end = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.end(id);
      clearSession();
      goToday(r.status === "completed" ? "Check-in closed." : "Check-in ended. Still will check in again at your next scheduled time.");
    } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const routeTo = (id: string, token: string, r: RouteResult, via: "classifier" | "clarify") => {
    pendingText.current = "";
    if (r.route === "help") { clearSession(); setFlow({ kind: "help", result: r }); }
    else if (r.route === "skill") setFlow({ kind: "result", id, token, result: r, via, closing: false, run: { phase: "idle" } });
    else if (r.route === "scope") {
      // Not a check-in: Still took no action. Same check-in, same question, empty answer box.
      pendingText.current = "";
      setFlow((f) => (f.kind === "prompt" ? { ...f, submitting: false, error: null, scope: true } : f));
    }
    else setFlow({ kind: "clarify", id, token, result: r, busy: false });
  };
  const submit = async (text: string) => {
    if (flow.kind !== "prompt") return;
    const { id, start } = flow;
    pendingText.current = text;
    setFlow({ ...flow, submitting: true, error: null, scope: false });
    try {
      routeTo(id, start.token, await api.respond(id, start.token, text), "classifier");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 0)) {
        setFlow({ kind: "prompt", id, start, submitting: false,
          error: e.status === 0 ? "Can't reach Still's server. Your words are still here — try again." : "That couldn't be read. Try a sentence or two." });
      } else lost(e);
    }
  };
  const choose = async (choice: string) => {
    if (flow.kind !== "clarify") return;
    const { id, token, result } = flow;
    setFlow({ ...flow, busy: true });
    try { routeTo(id, token, await api.clarify(id, token, choice, result.hold), "clarify"); } catch (e) { lost(e); }
  };
  // ACT — the one executor the server attached. The server records the start (idempotent), then it runs here.
  const setRun = (run: RunState) => setFlow((f) => (f.kind === "result" ? { ...f, run } : f));
  const startAction = async () => {
    if (flow.kind !== "result" || flow.run.phase !== "idle") return;
    const { id, token, result } = flow;
    const a = result.action;
    setRun({ phase: "starting" });
    try {
      if (a.executor === "COPY_MESSAGE" && a.message) await copyText(a.message);
      await api.act(id, token);
      if (a.executor === "COPY_MESSAGE") setRun({ phase: "done", result: "copied" });
      else if (a.executor === "ACKNOWLEDGE") await close("acknowledged");
      else setRun({ phase: "running", startedAt: Date.now() });
    } catch (e) { lost(e); }
  };
  const finishAction = (result: "completed" | "stopped") => setRun({ phase: "done", result });

  const close = async (forced?: string) => {
    if (flow.kind !== "result" && flow.kind !== "clarify") return;
    const actionResult = forced ?? (flow.kind === "result" ? flow.run.result : undefined);
    const step = flow.kind === "result"
      ? { id: flow.result.skill.id, title: flow.result.skill.title, action: flow.result.action.label, result: actionResult ?? "not_started" }
      : null;
    if (flow.kind === "result") setFlow({ ...flow, closing: true }); else setFlow({ ...flow, busy: true });
    try {
      const r = await api.close(flow.id, flow.token, actionResult);
      clearSession(); await refresh();
      setFlow({ kind: "done", step: step && { ...step, result: r.action_result } });
    } catch (e) { lost(e); }
  };
  const leave = () => { setFlow({ kind: "home" }); refresh(); };
  useEffect(() => { setNotice(null); }, [tab]);

  // ---- crisis: replaces everything, instantly, no transition ----
  if (flow.kind === "help") return <Crisis result={flow.result} onHome={() => goToday()} />;

  const left = (
    <>
      <p className="tagline"><b>still.</b> — a check&#8209;in that knows when to stop</p>
      <div style={{ marginTop: "auto" }}>
        <SkillsCarousel skills={protocol?.skills ?? []} />
        <p className="small" style={{ marginTop: 14 }}>One reviewed step per check&#8209;in. Still never writes its own advice.</p>
      </div>
    </>
  );

  let main: React.ReactNode;
  let right: React.ReactNode = null;
  let dark = false;
  let focus = false;

  if (!state) {
    main = <p className="lead">{offline ? "Can't reach Still's server." : "Loading…"}</p>;
  } else if (tab === "schedule") {
    main = <Schedule state={state} onSaved={(m) => { setNotice(m); refresh(); }} />;
    right = <ScheduleSide />;
  } else if (tab === "how") {
    main = <How protocol={protocol} />;
    dark = true;
  } else if (tab === "help") {
    main = <HelpTab helplines={state.helplines} />;
  } else if (flow.kind === "prompt") {
    focus = true;
    main = <PromptPanel start={flow.start} submitting={flow.submitting} error={flow.error} scope={!!flow.scope} initialText={pendingText.current} onSubmit={submit} onLeave={leave} />;
  } else if (flow.kind === "result") {
    focus = true;
    main = <ResultPanel result={flow.result} classifier={state.classifier} via={flow.via} run={flow.run} closing={flow.closing}
      onStart={startAction} onFinish={finishAction} onDone={() => close()} />;
  } else if (flow.kind === "clarify") {
    focus = true;
    main = <ClarifyPanel result={flow.result} busy={flow.busy} onChoose={choose} onClose={() => close()} />;
  } else if (flow.kind === "done") {
    main = <DonePanel state={state} step={flow.step} onHome={() => goToday()} />;
  } else {
    main = <Today state={state} notice={notice} busy={busy} onCheckInNow={checkInNow} onBegin={begin} onSkip={skip} onResume={resume} onFinish={finish} onTakeOver={takeOver} onEnd={end} />;
    right = <TodaySide state={state} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      {offline && <div className="offline" role="alert">Can't reach Still's server — nothing here is simulated.</div>}
      <Shell tab={tab} state={state} dark={dark} focus={focus} left={left} right={right}>{main}</Shell>
    </MotionConfig>
  );
}

export { TAB_HREF };

/** Clipboard write with a fallback for browsers without the async Clipboard API. */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
}
