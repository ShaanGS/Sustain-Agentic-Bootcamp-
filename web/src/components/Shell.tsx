import type { ReactNode } from "react";
import { LifeBuoy } from "lucide-react";

export function Shell({
  children, center, surface = "paper", route, onHome, onSupport, banner,
}: {
  children: ReactNode;
  center?: ReactNode;
  surface?: "paper" | "system";
  route: "home" | "protocol";
  onHome: () => void;
  onSupport?: () => void;
  banner?: ReactNode;
}) {
  return (
    <div className="frame">
      <div className="sheet" data-surface={surface}>
        <header className="topbar">
          <button className="wordmark" onClick={onHome} aria-label="Still — home">
            <span className="wordmark-dot" aria-hidden />Still
          </button>
          <div className="topbar-center">{center}</div>
          <div className="topbar-right">
            <a className="quiet-link" href={route === "protocol" ? "#/" : "#/protocol"} aria-current={route === "protocol" ? "page" : undefined}>
              {route === "protocol" ? "Back to check-in" : "Protocol"}
            </a>
            {onSupport && (
              <button className="quiet-link" onClick={onSupport}>
                <LifeBuoy size={15} strokeWidth={1.75} aria-hidden /><span>Human support</span>
              </button>
            )}
          </div>
        </header>
        {banner}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
