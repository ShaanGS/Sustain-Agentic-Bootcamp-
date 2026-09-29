// The bounded journey, always visible during a check-in.
export const JOURNEY = ["Schedule", "Ready", "Prompt", "Safety", "Understand", "One action", "End"] as const;
export type JourneyStep = (typeof JOURNEY)[number];

/** `current` may hold two steps while a single request covers both (safety + understand). */
export function JourneyRail({ current }: { current: JourneyStep[] }) {
  const first = Math.min(...current.map((c) => JOURNEY.indexOf(c)));
  const stateOf = (i: number) => (current.includes(JOURNEY[i]) ? "current" : i < first ? "done" : "todo");
  const pos = Math.max(...current.map((c) => JOURNEY.indexOf(c))) + 1;
  return (
    <nav aria-label="Check-in progress">
      <ol className="rail">
        {JOURNEY.map((step, i) => (
          <li key={step}>
            {i > 0 && <span className="rail-sep" aria-hidden />}
            <span className="rail-step" data-state={stateOf(i)} aria-current={stateOf(i) === "current" ? "step" : undefined}>
              <span className="rail-mark" aria-hidden />
              <span className="rail-label">{step}</span>
            </span>
          </li>
        ))}
      </ol>
      <span className="rail-compact">
        {current.join(" · ")} — {pos} of {JOURNEY.length}
      </span>
    </nav>
  );
}
