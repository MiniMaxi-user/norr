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
  // The idle button of the pair (e.g. "Start work" while travel is
  // running) sits on the now-solid-gold card once anything is running — a
  // solid-gold `"primary"` button would blend straight into it, so it
  // drops to `"outline"` whenever the card itself is in its accent state.
  // Idle with nothing running at all keeps `"primary"` (gold on the neutral
  // card) for both buttons — "Start travel" included, matching "Start
  // work"'s existing default.
  const idleVariant = running ? "outline" : "primary";

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
      <Card style={running ? { background: "var(--ui-accent)", borderColor: "var(--ui-accent)" } : undefined}>
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
    </div>
  );
}
