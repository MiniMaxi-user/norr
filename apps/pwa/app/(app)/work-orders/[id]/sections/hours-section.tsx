"use client";

import { Badge, Card, Inline, Stack, Text } from "@yourorg/ui";
import { formatClockHoursMinutes } from "@/lib/time/clocks";
import type { ClockPeriod } from "@/lib/offline/db";
import type { WorkOrderTimeEntry } from "@/lib/work-orders/types";

interface HourRow {
  id: string;
  kind: "travel" | "work";
  startedAt: number;
  endedAt: number | null;
}

function formatRange(startedAt: number, endedAt: number | null): string {
  const format = (ms: number) => {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  return `${format(startedAt)}–${endedAt === null ? "running" : format(endedAt)}`;
}

/**
 * The "Hours" tab (issue #170, IMPLEMENTATION.md §4) — merges this device's
 * own local, not-yet-synced `clockPeriods` with the real, server-side
 * `time_entries` `/api/work-orders/[id]` already returns, into one
 * chronological list. Deliberately read-only: IMPLEMENTATION.md §4's own
 * "tikken op een regel is corrigeren" ("tapping a row corrects it") isn't
 * implemented here — building a real correction flow (which local period
 * to mutate, validation, what happens to an already-synced server entry) is
 * a separate feature this story's scope doesn't otherwise ask for, so this
 * renders the list without overclaiming that tap behavior in its copy.
 */
export function HoursSection({
  periods,
  serverTimeEntries,
}: {
  periods: ClockPeriod[];
  serverTimeEntries: WorkOrderTimeEntry[];
}) {
  const now = Date.now();

  const localRows: HourRow[] = periods.map((period) => ({
    id: `local-${period.id}`,
    kind: period.kind,
    startedAt: period.startedAt,
    endedAt: period.endedAt,
  }));
  const serverRows: HourRow[] = serverTimeEntries.map((entry) => ({
    id: `server-${entry.id}`,
    kind: entry.kind,
    startedAt: new Date(entry.startedAt).getTime(),
    endedAt: entry.endedAt ? new Date(entry.endedAt).getTime() : null,
  }));

  const rows = [...serverRows, ...localRows].sort((a, b) => a.startedAt - b.startedAt);

  const totals = rows.reduce(
    (acc, row) => {
      const elapsed = (row.endedAt ?? now) - row.startedAt;
      if (row.kind === "travel") acc.travelMs += elapsed;
      else acc.workMs += elapsed;
      return acc;
    },
    { travelMs: 0, workMs: 0 },
  );
  const totalMs = totals.travelMs + totals.workMs;

  return (
    <Stack gap="md">
      <Inline justify="between" align="center">
        <Text style={{ fontSize: "11px", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ui-muted-subtle)" }}>
          Hours
        </Text>
        <Text style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatClockHoursMinutes(totalMs)}</Text>
      </Inline>

      {rows.length === 0 ? (
        <Card>
          <Text tone="muted">Nothing logged yet · 0h 00m</Text>
        </Card>
      ) : (
        <Card>
          <Stack gap="sm">
            {rows.map((row) => (
              <Inline key={row.id} justify="between" align="center" gap="sm">
                <Inline gap="sm" align="center">
                  <Badge variant={row.kind === "travel" ? "muted" : "success"}>
                    {row.kind === "travel" ? "Travel" : "Work"}
                  </Badge>
                  <Text tone="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatRange(row.startedAt, row.endedAt)}
                  </Text>
                </Inline>
                <Text style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatClockHoursMinutes((row.endedAt ?? now) - row.startedAt)}
                </Text>
              </Inline>
            ))}
          </Stack>
        </Card>
      )}

      <Text tone="muted">Times come from the timer on this device.</Text>

      <Inline justify="between" gap="sm" wrap>
        <Text tone="muted">Travel {formatClockHoursMinutes(totals.travelMs)}</Text>
        <Text tone="muted">Work {formatClockHoursMinutes(totals.workMs)}</Text>
      </Inline>
    </Stack>
  );
}
