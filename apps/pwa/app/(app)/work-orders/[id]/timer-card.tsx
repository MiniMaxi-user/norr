"use client";

import { Button, Card, Inline, Stack, Text } from "@yourorg/ui";
import { formatClockDigits, formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";

/**
 * The sticky timer card (issue #170, IMPLEMENTATION.md §4) — `position:
 * sticky; top: 0` so start/stop is always one tap away regardless of scroll
 * position. Purely presentational: all the state-machine rules (max one
 * order running, travel/work mutually exclusive) live in
 * `lib/time/clocks.ts`; this component just renders whatever `summary` it's
 * handed and calls back on a tap, same "dumb view, smart state" split as
 * every other section here.
 *
 * `Card tone="accent"` for the running state reuses the design system's own
 * existing accent-card treatment (`ui-card-accent` in styles.css) rather
 * than a bespoke background — that CSS already renders the exact
 * "`#c79a3e` fill, `#1f3540`-equivalent (`--ui-accent-fg`) text" look
 * IMPLEMENTATION.md §4 calls for.
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

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        paddingTop: "0.5rem",
        paddingBottom: "0.25rem",
        background: "var(--ui-page-bg)",
      }}
    >
      <Card tone={running ? "accent" : "default"}>
        <Inline justify="between" align="start" gap="md" wrap>
          <Stack gap="xs">
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
            <Text tone={running ? undefined : "muted"} style={{ color: bodyColor, fontVariantNumeric: "tabular-nums" }}>
              Travel {formatClockHoursMinutes(summary.travelMs)} · Work {formatClockHoursMinutes(summary.workMs)}
            </Text>
          </Stack>

          <Stack gap="xs">
            <Button
              variant={summary.runningKind === "travel" ? "danger" : "outline"}
              onClick={onToggleTravel}
              style={{ minHeight: 44 }}
            >
              {summary.runningKind === "travel" ? "Stop travel" : "Start travel"}
            </Button>
            <Button
              variant={summary.runningKind === "work" ? "danger" : "primary"}
              onClick={onToggleWork}
              style={{ minHeight: 44 }}
            >
              {summary.runningKind === "work" ? "Stop work" : "Start work"}
            </Button>
          </Stack>
        </Inline>
      </Card>
    </div>
  );
}
