import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api, ApiError, type RouteResult, type StartResult } from "./lib/api";
import { useAppState } from "./lib/useLive";
import { clearSession, loadSession, saveSession } from "./lib/session";
import { Shell } from "./components/Shell";
import { JourneyRail, type JourneyStep } from "./components/JourneyRail";
import { SupportPanel } from "./components/SupportPanel";
import { Home } from "./screens/Home";
import { Prompt } from "./screens/CheckIn";
import { Result } from "./screens/Result";
import { Clarify } from "./screens/Clarify";
import { Help } from "./screens/Help";
import { Done } from "./screens/Done";
import { Protocol } from "./screens/Protocol";

type Skill = Extract<RouteResult, { route: "skill" }>;
type Clar = Extract<RouteResult, { route: "clarify" }>;
type HelpR = Extract<RouteResult, { route: "help" }>;

/** Client view of the server state machine. Each variant is entered only from a real API response. */
type Flow =
  | { kind: "home" }
  | { kind: "prompt"; id: string; start: StartResult; submitting: boolean; error: string | null }
  | { kind: "result"; id: string; token: string; result: Skill; via: "classifier" | "clarify"; closing: boolean }
  | { kind: "clarify"; id: string; token: string; result: Clar; busy: boolean }
  | { kind: "help"; result: HelpR }
  | { kind: "done"; stepTitle: string | null };

const RAIL: Record<Flow["kind"], JourneyStep[]> = {
  home: ["Schedule"], prompt: ["Prompt"], result: ["One action"], clarify: ["Understand"], help: [], done: ["End"],
};

function useHashRoute() {
  const get = () => (location.hash.startsWith("#/protocol") ? "protocol" : "home") as "home" | "protocol";
  const [route, setRoute] = useState(get);
  useEffect(() => { const f = () => setRoute(get()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const { state, offline, refresh } = useAppState(route === "home" ? 4000 : 10000);
  const [flow, setFlow] = useState<Flow>({ kind: "home" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState(false);
  // The response lives only here, in memory, while its request is in flight (so a network error doesn't lose it).
  const pendingText = useRef("");

  const goHome = useCallback((msg?: string) => {
    setFlow({ kind: "home" });
    setNotice(msg ?? null);
    refresh();
    if (location.hash) location.hash = "";
  }, [refresh]);

  const lost = useCallback((e: unknown) => {
    clearSession();
    pendingText.current = "";
    if (e instanceof ApiError && e.status === 0) return goHome("Can't reach Still's server. Your check-in is unchanged on the server.");
    goHome("This check-in closed before it finished. You can start a new one any time.");
  }, [goHome]);

  // ----- actions (each one is a real endpoint) -----
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
    try { await api.skip(id); goHome("Skipped. Still will check in again at your next scheduled time."); } catch (e) { lost(e); } finally { setBusy(false); }
  };
  const resume = () => {
    const s = loadSession();
    if (s) setFlow({ kind: "prompt", id: s.id, start: s.start, submitting: false, error: null });
  };
  const finish = async () => {
    const s = loadSession();
    if (!s) return;
    try { await api.close(s.id, s.start.token); clearSession(); await refresh(); setFlow({ kind: "done", stepTitle: null }); } catch (e) { lost(e); }
  };

  const route_ = (id: string, token: string, r: RouteResult, via: "classifier" | "clarify") => {
    pendingText.current = "";
    if (r.route === "help") { clearSession(); setFlow({ kind: "help", result: r }); }
    else if (r.route === "skill") setFlow({ kind: "result", id, token, result: r, via, closing: false });
    else setFlow({ kind: "clarify", id, token, result: r, busy: false });
  };

  const submit = async (text: string) => {
    if (flow.kind !== "prompt") return;
    const { id, start } = flow;
    pendingText.current = text;
    setFlow({ ...flow, submitting: true, error: null });
    try {
      const r = await api.respond(id, start.token, text);
      route_(id, start.token, r, "classifier");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setFlow({ kind: "prompt", id, start, submitting: false, error: "That response couldn't be read. Try a sentence or two." });
      } else if (e instanceof ApiError && e.status === 0) {
        setFlow({ kind: "prompt", id, start, submitting: false, error: "Can't reach Still's server. Your words are still here — try again." });
      } else lost(e);
    }
  };

  const choose = async (choice: string) => {
    if (flow.kind !== "clarify") return;
    const { id, token } = flow;
    setFlow({ ...flow, busy: true });
    try { route_(id, token, await api.clarify(id, token, choice), "clarify"); } catch (e) { lost(e); }
  };

  const close = async () => {
    if (flow.kind !== "result" && flow.kind !== "clarify") return;
    const stepTitle = flow.kind === "result" ? flow.result.skill.title : null;
    if (flow.kind === "result") setFlow({ ...flow, closing: true }); else setFlow({ ...flow, busy: true });
    try {
      await api.close(flow.id, flow.token);
      clearSession();
      await refresh();
      setFlow({ kind: "done", stepTitle });
    } catch (e) { lost(e); }
  };

  // ----- crisis: replaces everything, rendered instantly, no transition -----
  if (flow.kind === "help") return <Help result={flow.result} onHome={() => goHome()} />;

  const banner = offline ? <div className="banner" role="alert">Can't reach Still's server. Nothing shown here is simulated — it will update when the server is back.</div> : null;

  if (route === "protocol") {
    return (
      <MotionConfig reducedMotion="user">
        <Shell surface="system" route="protocol" onHome={() => goHome()} banner={banner}>
          <Protocol />
        </Shell>
      </MotionConfig>
    );
  }

  const railSteps: JourneyStep[] =
    flow.kind === "prompt" && flow.submitting ? ["Safety", "Understand"]
      : flow.kind === "home" && state?.open_checkin?.status === "ready" ? ["Ready"]
      : RAIL[flow.kind];

  let screen;
  if (!state) screen = <p className="meta" style={{ paddingTop: "var(--s-8)" }}>{offline ? "Can't reach Still's server." : "Loading…"}</p>;
  else if (flow.kind === "home") screen = (
    <Home state={state} notice={notice} busy={busy} onSaved={() => { setNotice(null); refresh(); }}
      onCheckInNow={checkInNow} onBegin={begin} onSkip={skip} onResume={resume} onFinish={finish} />
  );
  else if (flow.kind === "prompt") screen = (
    <Prompt start={flow.start} submitting={flow.submitting} error={flow.error} initialText={pendingText.current} onSubmit={submit} />
  );
  else if (flow.kind === "result") screen = (
    <Result result={flow.result} classifier={state.classifier} via={flow.via} closing={flow.closing} onDone={close} />
  );
  else if (flow.kind === "clarify") screen = <Clarify result={flow.result} busy={flow.busy} onChoose={choose} onClose={close} />;
  else screen = <Done state={state} stepTitle={flow.stepTitle} onHome={() => goHome()} />;

  return (
    <MotionConfig reducedMotion="user">
      <Shell route="home" onHome={() => goHome()}
        onSupport={() => setSupport(true)} center={<JourneyRail current={railSteps} />} banner={banner}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={flow.kind} style={{ flex: 1, display: "flex", flexDirection: "column" }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}>
            {screen}
          </motion.div>
        </AnimatePresence>
      </Shell>
      <SupportPanel open={support} onClose={() => setSupport(false)} helplines={state?.helplines} />
    </MotionConfig>
  );
}
