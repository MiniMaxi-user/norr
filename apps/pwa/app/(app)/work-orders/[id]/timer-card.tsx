"use client";

import { Button, Card, Inline, Stack, Text } from "@yourorg/ui";
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
 * No longer `position: sticky` (product feedback, 2026-09-13: it was pinned
 * to the top of the scroll container, which read as "stuck" rather than
 * part of the page) — it scrolls with the rest of the Hours tab like every
 * other card.
 *
 * Running state: `--ui-accent-fg` (`#1f3540`, dark navy) is only readable
 * against a SOLID accent fill — that's the combination IMPLEMENTATION.md §4
 * specs ("kaart in accent `#c79a3e` met tekst `#1f3540`"). `Card
 * tone="accent"` doesn't give that: `.ui-card-accent` fills with
 * `--ui-accent-tint`, a ~16–20% translucent wash meant for chips/CTA cards
 * sitting on a neutral surface, not a running-state indicator — the dark
 * navy text on that pale wash was unreadable (bug report, 2026-09-12). So
 * this card overrides the background/border directly with the solid
 * `--ui-accent` token instead of using `tone`.
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
  const label =
    summary.runningKind === "travel"
      ? "Travel time running"
      : summary.runningKind === "work"
        ? "Work time running"
        : "Timer paused · total today";
  const labelColor = running ? "var(--ui-accent-fg)" : "var(--ui-muted-subtle)";
  const bodyColor = running ? "var(--ui-accent-fg)" : undefined;
  // Idle buttons always render `"dark"` now (product feedback, 2026-09-13 —
  // supersedes the old gold-`"primary"`-on-neutral-card default): a dark
  // fixed-ink fill reads as a resting/secondary action on both the neutral
  // card and the solid-gold running card, so it no longer needs to switch
  // to `"outline"` just to stay legible once something starts running.
  const idleVariant = "dark";

  return (
    <Card style={running ? { background: "var(--ui-accent)", borderColor: "var(--ui-accent)" } : undefined}>
      <Inline justify="between" align="start" gap="md">
        <Stack gap="xs" style={{ minWidth: 0, flex: 1 }}>
          <Text
            style={{
              fontSize: "11px",
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: labelColor,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              fontSize: "2rem",
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: bodyColor ?? "var(--ui-fg)",
            }}
          >
            {formatClockDigits(digitsMs)}
          </Text>
          {/* Two lines, not one joined by "·" (product feedback,
              2026-09-13) — the single line competed with the button column
              for width and pushed it onto its own row on narrower cards. */}
          <Text tone={running ? undefined : "muted"} style={{ color: bodyColor, fontVariantNumeric: "tabular-nums" }}>
            Travel {formatClockHoursMinutes(summary.travelMs)}
          </Text>
          <Text tone={running ? undefined : "muted"} style={{ color: bodyColor, fontVariantNumeric: "tabular-nums" }}>
            Work {formatClockHoursMinutes(summary.workMs)}
          </Text>
        </Stack>

        <Stack gap="xs" style={{ flexShrink: 0 }}>
          <Button
            variant={summary.runningKind === "travel" ? "danger" : idleVariant}
            onClick={onToggleTravel}
            style={{ minHeight: 44 }}
          >
            {summary.runningKind === "travel" ? "Stop travel" : "Start travel"}
          </Button>
          <Button
            variant={summary.runningKind === "work" ? "danger" : idleVariant}
            onClick={onToggleWork}
            style={{ minHeight: 44 }}
          >
            {summary.runningKind === "work" ? "Stop work" : "Start work"}
          </Button>
        </Stack>
      </Inline>
    </Card>
  );
}
