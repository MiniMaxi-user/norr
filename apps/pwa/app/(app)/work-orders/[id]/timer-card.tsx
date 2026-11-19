"use client";

import { WebButton, WebCard, WebStatusBadge } from "@yourorg/ui/web";
import { Pause, Play } from "@yourorg/ui/icons";
import { formatClockDigits, formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";

/**
 * The timer card (issue #170, IMPLEMENTATION.md §4), shown only on the Hours
 * tab (product feedback, 2026-09-13 — start/stop no longer needs to follow
 * the engineer across every section, only the one it belongs to; see
 * `work-order-detail.tsx`). Purely presentational: all the state-machine
 * rules (max one order running, travel/work mutually exclusive) live in
 * `lib/time/clocks.ts`; this component just renders whatever `summary` it's
 * handed and calls back on a tap, same "dumb view, smart state" split as
 * every other section here.
 *
 * Presentation (issue #222, DS 08): idle is a calm touch card with the day
 * total and two secondary Start buttons. Running reads as "live" — warning-
 * tinted head with a pulsing dot and a "Live" badge, the running time larger
 * in mono, and the running kind's button turns into a distinct red Stop.
 */
export function TimerCard({
  summary,
  onToggleTravel,
  onToggleWork,
}: {
  summary: ClockSummary;
  onToggleTravel: () => void;
  onToggleWork: () => void;
}) {
  const running = summary.runningKind !== null;
  const totalMs = summary.travelMs + summary.workMs;
  const digitsMs = summary.runningKind === "travel" ? summary.travelMs : summary.runningKind === "work" ? summary.workMs : totalMs;

  return (
    <WebCard
      size="touch"
      data-running={running ? "true" : undefined}
      title={
        running ? (
          <span className="pwa-live-title">
            <span aria-hidden className="pwa-live-dot" />
            {summary.runningKind === "travel" ? "Travel running" : "Work running"}
          </span>
        ) : (
          "Timer paused · total today"
        )
      }
      action={
        running ? (
          <WebStatusBadge tone="warning" size="touch">
            Live
          </WebStatusBadge>
        ) : undefined
      }
    >
      <div className="pwa-timer">
        <div className="pwa-timer-main">
          <span className="pwa-timer-digits" data-running={running ? "true" : undefined} aria-live="off">
            {formatClockDigits(digitsMs)}
          </span>
          <span className="pwa-timer-totals">
            <span>Travel {formatClockHoursMinutes(summary.travelMs)}</span>
            <span>Work {formatClockHoursMinutes(summary.workMs)}</span>
          </span>
        </div>

        <div className="pwa-timer-actions">
          <TimerButton kind="travel" running={summary.runningKind === "travel"} onClick={onToggleTravel} />
          <TimerButton kind="work" running={summary.runningKind === "work"} onClick={onToggleWork} />
        </div>
      </div>
    </WebCard>
  );
}

/** One Start/Stop button: idle = secondary with a Play icon, running = the
 * distinct red Stop. */
function TimerButton({ kind, running, onClick }: { kind: "travel" | "work"; running: boolean; onClick: () => void }) {
  const label = `${running ? "Stop" : "Start"} ${kind}`;
  return (
    <WebButton size="touch" block variant={running ? "danger" : "secondary"} onClick={onClick} aria-label={label}>
      {running ? <Pause aria-hidden fill="currentColor" stroke="none" /> : <Play aria-hidden fill="currentColor" stroke="none" />}
      {label}
    </WebButton>
  );
}
