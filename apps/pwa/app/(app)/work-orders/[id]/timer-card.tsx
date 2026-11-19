"use client";

import { WebCard, WebStatusBadge } from "@yourorg/ui/web";
import { Pause, Play, type Icon } from "@yourorg/ui/icons";
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
 * Presentation (issue #222, DS 08): a regular touch card — tinted header with
 * a running status badge on the right, the elapsed digits in mono, the
 * Travel/Work totals, and one round Play/Pause toggle per kind (idle = white
 * with a navy ring, running = green). Gold is not used on this light surface.
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
      title={running ? "Timer running" : "Timer paused · total today"}
      action={
        running ? (
          <WebStatusBadge tone="success" size="touch">
            {summary.runningKind === "travel" ? "Travel running" : "Work running"}
          </WebStatusBadge>
        ) : undefined
      }
    >
      <div className="pwa-timer">
        <div className="pwa-timer-main">
          <span className="pwa-timer-digits">{formatClockDigits(digitsMs)}</span>
          <span className="pwa-timer-totals">
            <span>Travel {formatClockHoursMinutes(summary.travelMs)}</span>
            <span>Work {formatClockHoursMinutes(summary.workMs)}</span>
          </span>
        </div>

        <div className="pwa-timer-toggles">
          <TimerToggle
            icon={summary.runningKind === "travel" ? Pause : Play}
            active={summary.runningKind === "travel"}
            label="Travel"
            ariaLabel={summary.runningKind === "travel" ? "Stop travel" : "Start travel"}
            onClick={onToggleTravel}
          />
          <TimerToggle
            icon={summary.runningKind === "work" ? Pause : Play}
            active={summary.runningKind === "work"}
            label="Work"
            ariaLabel={summary.runningKind === "work" ? "Stop work" : "Start work"}
            onClick={onToggleWork}
          />
        </div>
      </div>
    </WebCard>
  );
}

/** One round Play/Pause toggle + its label (see `TimerCard`'s own doc
 * comment). A plain `<button>`: this round icon-plus-label-underneath shape
 * is PWA-specific chrome, styled via the shared `.pwa-timer-toggle*`
 * classes in the design system's `pwa.css` (CLAUDE.md rule 4). */
function TimerToggle({
  icon: IconComponent,
  active,
  label,
  ariaLabel,
  onClick,
}: {
  icon: Icon;
  active: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <span className="pwa-timer-toggle-group">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className="pwa-timer-toggle"
        data-active={active ? "true" : undefined}
      >
        <IconComponent aria-hidden width={22} height={22} fill="currentColor" stroke="none" />
      </button>
      <span className="pwa-timer-toggle-label" data-active={active ? "true" : undefined}>
        {label}
      </span>
    </span>
  );
}
