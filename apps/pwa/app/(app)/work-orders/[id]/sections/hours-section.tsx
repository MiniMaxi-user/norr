"use client";

import { useState } from "react";
import { Badge, Card, Inline, Stack, Text } from "@yourorg/ui";
import { computeRoundedMinutes, type TimeRoundingRule } from "@yourorg/time-rounding";
import { deleteClockPeriod, updateClockPeriodTimes, type ClockPeriod } from "@/lib/offline/db";
import { formatClockHoursMinutes } from "@/lib/time/clocks";
import type { TimeRoundingSettings, WorkOrderTimeEntry } from "@/lib/work-orders/types";
import { EditHoursDialog, type EditableHourRow } from "./edit-hours-dialog";
import { SwipeableRow } from "./swipeable-row";

/** Safe no-op rule (today's exact pre-#198 behavior) — used whenever the
 * org's cached rounding settings (issue #198,
 * `getCachedTimeRoundingSettings`/`work-order-detail.tsx`) aren't loaded
 * yet, e.g. the very first offline load before any sync has ever landed.
 * Never blocks rendering on the real settings arriving. */
const NO_OP_RULE: TimeRoundingRule = { minimumMinutes: null, roundingMinutes: null, direction: "up" };

interface HourRow {
  id: string;
  kind: "travel" | "work";
  startedAt: number;
  endedAt: number | null;
  /** The row's own `clockPeriods` id — only set for local (not-yet-synced)
   * rows, which is exactly the set this tab offers Edit/Delete on. `undefined`
   * for a server-synced `time_entries` row (see this file's own top doc
   * comment on why those stay read-only). */
  localId?: number;
}

/** Issue #198 — this row's rounded (billable) duration in minutes, applied
 * uniformly to local and server-synced rows alike (the rounding rule is the
 * same regardless of sync state) and to a still-RUNNING local period's live
 * elapsed time (an approximate in-progress reading either way — same
 * treatment a raw duration already got before this). `now` is only used for
 * a running row's `endedAt ?? now`. */
function netMinutesFor(row: HourRow, settings: TimeRoundingSettings | null, now: number): number {
  const rawMinutes = Math.max(0, Math.round(((row.endedAt ?? now) - row.startedAt) / 60000));
  const rule = settings ? settings[row.kind] : NO_OP_RULE;
  return computeRoundedMinutes(rawMinutes, rule);
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
 * chronological list.
 *
 * Edit/Delete (product feedback, 2026-09-13 — supersedes this section's
 * original "deliberately read-only" scope) is offered ONLY on a local,
 * already-CLOSED row: never a server-synced `time_entries` row (mutating an
 * already-committed accounting record needs its own authorized write route
 * + RLS policy, which doesn't exist yet — out of scope here, same boundary
 * `lib/offline/db.ts`'s top doc comment draws around every other local-only
 * mutation in this story), and never the currently-RUNNING local period
 * (editing a still-open row would silently stop it — a surprising side
 * effect neither Edit nor Delete should have). `SwipeableRow` renders every
 * row regardless — passing `undefined` for both handlers on an ineligible
 * row just makes it inert (no reveal, no drag), so server rows and the
 * running row read exactly as they did before this feature, no separate
 * "read-only" branch needed.
 *
 * Issue #198: every duration shown here (per-row, the Travel/Work totals,
 * the top "Hours" badge) is the NET (rounded/billable) figure —
 * `netMinutesFor` — not the raw clocked one; the row's Start–End clock-time
 * range (`formatRange`) is unaffected and always stays raw, since that's
 * what actually happened, not a billable amount. Edit (`EditHoursDialog`)
 * still edits the row's real gross start/end clock times exactly as before
 * — this only changes what duration figure gets DISPLAYED here.
 */
export function HoursSection({
  periods,
  serverTimeEntries,
  onPeriodsChange,
  roundingSettings,
}: {
  periods: ClockPeriod[];
  serverTimeEntries: WorkOrderTimeEntry[];
  onPeriodsChange: () => void | Promise<void>;
  /** Issue #198 — the org's cached travel/work minimum + rounding settings
   * (`getCachedTimeRoundingSettings`, read by `work-order-detail.tsx`).
   * `null` until the first successful cache read — every duration below
   * falls back to a safe no-op rule (`NO_OP_RULE`) in that case rather than
   * blocking rendering on it. */
  roundingSettings: TimeRoundingSettings | null;
}) {
  const now = Date.now();
  const [editingRow, setEditingRow] = useState<EditableHourRow | null>(null);
  // Bumped on every Edit tap (including re-opening the same row after a
  // cancelled edit) — `EditHoursDialog` is keyed by this so it always
  // remounts fresh rather than reusing stale in-progress picker state; see
  // that component's own doc comment.
  const [editSession, setEditSession] = useState(0);

  const localRows: HourRow[] = periods.map((period) => ({
    id: `local-${period.id}`,
    kind: period.kind,
    startedAt: period.startedAt,
    endedAt: period.endedAt,
    localId: period.id,
  }));
  const serverRows: HourRow[] = serverTimeEntries.map((entry) => ({
    id: `server-${entry.id}`,
    kind: entry.kind,
    startedAt: new Date(entry.startedAt).getTime(),
    endedAt: entry.endedAt ? new Date(entry.endedAt).getTime() : null,
  }));

  const rows = [...serverRows, ...localRows].sort((a, b) => a.startedAt - b.startedAt);

  // Issue #198 — every duration below (the per-row figure, the Travel/Work
  // totals, and the top "Hours" badge) is the NET (rounded/billable) one,
  // summed from each row's own already-rounded minutes rather than rounding
  // one lump sum — same per-entry rounding the web work order screen and
  // `computeQuantityHours` (`app/(app)/work-orders/create-quote-actions.ts`)
  // already apply. The row's own Start–End clock-time range (`formatRange`
  // below) stays raw/gross regardless — only a duration figure is ever
  // rounded, never the logged clock times themselves.
  const totals = rows.reduce(
    (acc, row) => {
      const netMinutes = netMinutesFor(row, roundingSettings, now);
      if (row.kind === "travel") acc.travelMinutes += netMinutes;
      else acc.workMinutes += netMinutes;
      return acc;
    },
    { travelMinutes: 0, workMinutes: 0 },
  );
  const totalMinutes = totals.travelMinutes + totals.workMinutes;

  function handleEditTap(row: HourRow) {
    if (row.localId === undefined || row.endedAt === null) return;
    setEditingRow({ localId: row.localId, kind: row.kind, startedAt: row.startedAt, endedAt: row.endedAt });
    setEditSession((session) => session + 1);
  }

  async function handleDeleteTap(row: HourRow) {
    if (row.localId === undefined) return;
    await deleteClockPeriod(row.localId);
    await onPeriodsChange();
  }

  async function handleSaveEdit(localId: number, startedAt: number, endedAt: number) {
    await updateClockPeriodTimes(localId, startedAt, endedAt);
    await onPeriodsChange();
  }

  return (
    <Stack gap="md">
      <Inline justify="between" align="center">
        <Text style={{ fontSize: "11px", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ui-muted-subtle)" }}>
          Hours
        </Text>
        <Text style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatClockHoursMinutes(totalMinutes * 60000)}
        </Text>
      </Inline>

      {rows.length === 0 ? (
        <Card>
          <Text tone="muted">Nothing logged yet · 0h 00m</Text>
        </Card>
      ) : (
        <Stack gap="md">
          {rows.map((row) => {
            const editable = row.localId !== undefined && row.endedAt !== null;
            return (
              <SwipeableRow
                key={row.id}
                onEdit={editable ? () => handleEditTap(row) : undefined}
                onDelete={row.localId !== undefined ? () => void handleDeleteTap(row) : undefined}
              >
                <Inline justify="between" align="center" gap="sm">
                  <Inline gap="sm" align="center">
                    <Badge variant={row.kind === "travel" ? "muted" : "success"}>
                      {row.kind === "travel" ? "Travel" : "Work"}
                    </Badge>
                    <Text tone="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatRange(row.startedAt, row.endedAt)}
                    </Text>
                  </Inline>
                  <Text style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatClockHoursMinutes(netMinutesFor(row, roundingSettings, now) * 60000)}
                  </Text>
                </Inline>
              </SwipeableRow>
            );
          })}
        </Stack>
      )}

      <Text tone="muted">Times come from the timer on this device.</Text>

      <Inline justify="between" gap="sm" wrap>
        <Text tone="muted">Travel {formatClockHoursMinutes(totals.travelMinutes * 60000)}</Text>
        <Text tone="muted">Work {formatClockHoursMinutes(totals.workMinutes * 60000)}</Text>
      </Inline>

      <EditHoursDialog
        key={editSession}
        open={editingRow !== null}
        row={editingRow}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null);
        }}
        onSave={handleSaveEdit}
      />
    </Stack>
  );
}
