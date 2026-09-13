"use client";

import { Card, Inline, Stack, Text } from "@yourorg/ui";
import { Pause, Play, type Icon } from "@yourorg/ui/icons";
import { formatClockDigits, formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";

/** `@yourorg/ui` doesn't publish its internal `cx` helper at a subpath (only
 * `.`/`./icons`/`./styles.css` are exported) — same tiny inline join every
 * call site outside the package itself already falls back to (see
 * `_nav/bottom-bar.tsx`'s identical copy). */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

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
 * Redesigned per `docs/designinstructieskanweg/startstoppng.png` (product
 * feedback, 2026-09-13): a "TRAVEL/WORK RUNNING" pill with a dot replaces
 * the old plain running-state label; the old rectangular Start/Stop text
 * buttons are replaced by a round Play/Pause toggle per kind — dark-ink
 * idle (tap to start), solid `--ui-success` green + a green dot on its
 * label while it's the one currently running (tap to stop) — no more
 * `"danger"`/red for stopping. No longer `position: sticky` either (it was
 * pinned to the top of the scroll container, which read as "stuck" rather
 * than part of the page) — it scrolls with the rest of the Hours tab like
 * every other card.
 *
 * Always the solid accent card now (product feedback, 2026-09-13 —
 * supersedes the original "only gold while something's running" rule):
 * `--ui-accent-fg` (`#1f3540`, dark navy) is only readable against a SOLID
 * accent fill — that's the combination IMPLEMENTATION.md §4 specs ("kaart
 * in accent `#c79a3e` met tekst `#1f3540`"). `Card tone="accent"` doesn't
 * give that: `.ui-card-accent` fills with `--ui-accent-tint`, a ~16–20%
 * translucent wash meant for chips/CTA cards sitting on a neutral surface,
 * not this card — the dark navy text on that pale wash was unreadable (bug
 * report, 2026-09-12). So this card overrides the background/border
 * directly with the solid `--ui-accent` token instead of using `tone`,
 * unconditionally.
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
  // Always dark navy now that the card is always solid gold — no more
  // `running`-conditional muted/undefined fallback.
  const labelColor = "var(--ui-accent-fg)";

  return (
    <Card style={{ background: "var(--ui-accent)", borderColor: "var(--ui-accent)" }}>
      <Inline justify="between" align="end" gap="md">
        <Stack gap="xs" style={{ minWidth: 0, flex: 1 }}>
          {running ? (
            <span className="ui-timer-pill">
              <span className="ui-timer-pill-dot" aria-hidden />
              {summary.runningKind === "travel" ? "Travel running" : "Work running"}
            </span>
          ) : (
            <Text
              style={{
                fontSize: "11px",
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: labelColor,
              }}
            >
              Timer paused · total today
            </Text>
          )}

          <Text
            style={{
              fontSize: "2rem",
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: "var(--ui-accent-fg)",
            }}
          >
            {formatClockDigits(digitsMs)}
          </Text>

          <Inline gap="md">
            <Text style={{ color: "var(--ui-accent-fg)", fontVariantNumeric: "tabular-nums" }}>
              Travel {formatClockHoursMinutes(summary.travelMs)}
            </Text>
            <Text style={{ color: "var(--ui-accent-fg)", fontVariantNumeric: "tabular-nums" }}>
              Work {formatClockHoursMinutes(summary.workMs)}
            </Text>
          </Inline>
        </Stack>

        <Inline gap="md" style={{ flexShrink: 0 }}>
          <TimerToggle
            icon={summary.runningKind === "travel" ? Pause : Play}
            active={summary.runningKind === "travel"}
            label="Travel"
            labelColor={labelColor}
            ariaLabel={summary.runningKind === "travel" ? "Stop travel" : "Start travel"}
            onClick={onToggleTravel}
          />
          <TimerToggle
            icon={summary.runningKind === "work" ? Pause : Play}
            active={summary.runningKind === "work"}
            label="Work"
            labelColor={labelColor}
            ariaLabel={summary.runningKind === "work" ? "Stop work" : "Start work"}
            onClick={onToggleWork}
          />
        </Inline>
      </Inline>
    </Card>
  );
}

/** One round Play/Pause toggle + its label (see `TimerCard`'s own doc
 * comment for the reference design). A plain `<button>`, not `Button`
 * (`@yourorg/ui`) — this round icon-plus-label-underneath shape doesn't
 * exist as a variant there, and it's PWA-specific chrome the same way
 * `_nav/bottom-bar.tsx`'s step circles are: styled via shared `.ui-timer-
 * toggle-*` classes in the design system's `styles.css` (CLAUDE.md rule 4 —
 * PWA has no local CSS file to define these in on its own), not inline. */
function TimerToggle({
  icon: IconComponent,
  active,
  label,
  labelColor,
  ariaLabel,
  onClick,
}: {
  icon: Icon;
  active: boolean;
  label: string;
  labelColor: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <span className="ui-timer-toggle-group">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={cx("ui-timer-toggle", active ? "ui-timer-toggle-active" : "ui-timer-toggle-idle")}
      >
        <IconComponent aria-hidden width={22} height={22} fill="currentColor" stroke="none" />
      </button>
      <span className="ui-timer-toggle-label" style={{ color: labelColor }}>
        {active && <span className="ui-timer-toggle-label-dot" aria-hidden />}
        {label}
      </span>
    </span>
  );
}
