import type { ReactNode } from "react";
import { CalendarDays, CircleHelp, Home, LifeBuoy, Workflow } from "lucide-react";
import type { AppState } from "../lib/api";

export type Tab = "today" | "schedule" | "how" | "help";
export const TAB_HREF: Record<Tab, string> = { today: "#/", schedule: "#/schedule", how: "#/how", help: "#/help" };
const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "how", label: "How it works", icon: Workflow },
  { id: "help", label: "Help", icon: LifeBuoy },
];

/** App frame: header (ref 1), left nav + context column on desktop, tab bar on phones (ref 3). */
export function Shell({ tab, state, dark = false, focus = false, left, right, children }: {
  tab: Tab; state: AppState | null; dark?: boolean; focus?: boolean;
  left?: ReactNode; right?: ReactNode; children: ReactNode;
}) {
  const ready = state?.open_checkin?.status === "ready";
  const primary = state?.helplines.primary.numbers[0];
  const emergency = state?.helplines.emergency.numbers[0];
  return (
    <div className="page">
      <div className={`sheet ${dark ? "dark" : ""}`}>
        <header className="header">
          <a className="brand" href={TAB_HREF.today} aria-label="Still — Today">still<span>.</span></a>
          <div className="header-center">
            <a className="connect" href={TAB_HREF.help}>
              Talk to a person
              {primary && <span className="connect-chip">{primary.display}</span>}
              {emergency && <span className="connect-chip">{emergency.display}</span>}
            </a>
          </div>
          <div className="header-right">
            <a className="header-link" href={TAB_HREF.how}>How it works</a>
            <a className="circle-btn" href={TAB_HREF.how} aria-label="How it works"><CircleHelp size={20} /></a>
            <a className="circle-btn" href={TAB_HREF.help} aria-label="Human support"><LifeBuoy size={20} /></a>
          </div>
        </header>

        <div className={`layout ${right ? "" : "wide"}`}>
          <aside className="col-left">
            <nav className="nav" aria-label="Main">
              {TABS.map((t) => (
                <a key={t.id} href={TAB_HREF[t.id]} aria-current={tab === t.id ? "page" : undefined}>
                  {t.label}{t.id === "today" && ready && <span className="badge" aria-label="check-in ready" />}
                </a>
              ))}
            </nav>
            {left}
          </aside>
          <main className="col-main">{children}</main>
          {right && <aside className="col-right">{right}</aside>}
        </div>
      </div>
      {!focus && (
        <nav className={`tabbar ${dark ? "dark" : ""}`} aria-label="Tabs">
          {TABS.map((t) => (
            <a key={t.id} href={TAB_HREF[t.id]} aria-current={tab === t.id ? "page" : undefined}>
              <t.icon size={20} strokeWidth={1.8} aria-hidden />
              {t.id === "how" ? "How" : t.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
