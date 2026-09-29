import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AppState } from "./api";

/** Polls /api/state (and on window focus) so a scheduler-created check-in appears without a reload. */
export function useAppState(intervalMs = 5000) {
  const [state, setState] = useState<AppState | null>(null);
  const [offline, setOffline] = useState(false);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const s = await api.state();
      setState(s);
      setOffline(false);
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [refresh, intervalMs]);

  return { state, offline, refresh };
}

/** A ticking clock for countdowns, aligned to the server's notion of now. */
export function useNow(serverNow: number | undefined, everyMs = 1000) {
  const skew = useRef(0);
  useEffect(() => { if (serverNow) skew.current = serverNow - Date.now(); }, [serverNow]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now + skew.current;
}
