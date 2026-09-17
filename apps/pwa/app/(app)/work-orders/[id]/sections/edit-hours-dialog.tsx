"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, IconButton, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { X } from "@yourorg/ui/icons";
import { formatClockHoursMinutes } from "@/lib/time/clocks";

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 3;
const COLUMN_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** `{hours, minutes}` in LOCAL wall-clock time — seeds each wheel pair's
 * starting position from an epoch-ms timestamp. */
function msToHm(ms: number): { hours: number; minutes: number } {
  const date = new Date(ms);
  return { hours: date.getHours(), minutes: date.getMinutes() };
}

/** Rebuilds an epoch-ms timestamp on `baseMs`'s own calendar date, at wall-
 * clock `hours`:`minutes` — the inverse of `msToHm`, used by `handleSave` to
 * turn each wheel pair's selection back into a real timestamp. */
function atTimeOfDay(baseMs: number, hours: number, minutes: number): number {
  const date = new Date(baseMs);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** `"Friday 12 September"` — reused date-label shape as `today-screen.tsx`'s
 * `formatTodayDateLabel`, deliberately reimplemented rather than shared (see
 * that file's own note on why: no cross-file coupling for a one-liner). Shown
 * read-only in this dialog since the date itself is never directly editable
 * here — anchored to the row's original `startedAt` date; see
 * `EditHoursDialog`'s own doc comment on how an end time that wheels past
 * midnight rolls onto the next calendar day instead. */
function formatDateLabel(ms: number): string {
  const date = new Date(ms);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(date);
  return `${weekday} ${dayMonth}`;
}

/**
 * One scrollable hour/minute wheel (product feedback, 2026-09-13,
 * `docs/designinstructieskanweg/startstoppng.png`'s sibling reference for
 * this correction flow) — native CSS `scroll-snap`, no picker library.
 * Mount-only scroll-position sync to `value` (an `EditHoursDialog` remount
 * per edit, via its `key`, is what makes "mount-only" the right choice here
 * rather than fighting the user's own in-progress scroll on every prop
 * change — see that file's own doc comment). A debounced `scroll` handler
 * reads back the settled index once native snap has finished moving the
 * column, rather than fighting it with a second, JS-driven `scrollTo`.
 */
function WheelColumn({
  values,
  value,
  onChange,
  suffix,
  ariaLabel,
}: {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  suffix: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const index = values.indexOf(value);
    if (index >= 0) el.scrollTop = index * ITEM_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, see doc comment above
  }, []);

  function handleScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const index = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_HEIGHT)));
      const next = values[index];
      if (next !== undefined && next !== value) onChange(next);
    }, 120);
  }

  return (
    <div
      ref={ref}
      className="ui-wheel-picker-column"
      style={{ height: COLUMN_HEIGHT }}
      onScroll={handleScroll}
      role="listbox"
      aria-label={ariaLabel}
    >
      <div className="ui-wheel-picker-spacer" style={{ height: ITEM_HEIGHT }} aria-hidden />
      {values.map((item) => (
        <div key={item} className="ui-wheel-picker-item" style={{ height: ITEM_HEIGHT }} role="option" aria-selected={item === value}>
          {item}
          {suffix}
        </div>
      ))}
      <div className="ui-wheel-picker-spacer" style={{ height: ITEM_HEIGHT }} aria-hidden />
    </div>
  );
}

export interface EditableHourRow {
  /** The local `clockPeriods` row id — this dialog only ever edits a local,
   * already-closed row (never a running period, never a server-synced
   * entry — `hours-section.tsx` only offers Edit under those conditions). */
  localId: number;
  kind: "travel" | "work";
  startedAt: number;
  endedAt: number;
}

/**
 * The Hours tab's swipe-to-edit correction sheet — two INDEPENDENT wheel
 * pairs (product feedback, 2026-09-17: the previous single duration-only
 * wheel pair didn't let a correction move the actual start/end clock time,
 * only how long the period lasted) set the row's real Start and End wall-
 * clock time directly; both `startedAt` and `endedAt` are recomputed on
 * Save via `atTimeOfDay`, anchored to the row's original `startedAt` date.
 * If the selected End time-of-day would land at or before the selected
 * Start time-of-day (e.g. correcting an overnight period), it's rolled onto
 * the next calendar day instead of being treated as a zero/negative
 * duration — the same "wheel past midnight" behavior a physical clock
 * dial would produce.
 *
 * Remounted (via the `key` its call site passes) every time a different Edit
 * tap opens it — including re-opening the SAME row after a cancelled edit —
 * so all four wheels' state always initializes fresh from `row` with a
 * plain `useState` lazy initializer instead of a `useEffect` that would race
 * `WheelColumn`'s own mount-time scroll sync (see that component's doc
 * comment).
 */
export function EditHoursDialog({
  open,
  onOpenChange,
  row,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: EditableHourRow | null;
  onSave: (localId: number, startedAt: number, endedAt: number) => void | Promise<void>;
}) {
  useEscapeToClose(open, onOpenChange);

  const [startHours, setStartHours] = useState(() => (row ? msToHm(row.startedAt).hours : 0));
  const [startMinutes, setStartMinutes] = useState(() => (row ? msToHm(row.startedAt).minutes : 0));
  const [endHours, setEndHours] = useState(() => (row ? msToHm(row.endedAt).hours : 0));
  const [endMinutes, setEndMinutes] = useState(() => (row ? msToHm(row.endedAt).minutes : 0));
  const [saving, setSaving] = useState(false);

  const startedAt = row ? atTimeOfDay(row.startedAt, startHours, startMinutes) : 0;
  const endedAtRaw = row ? atTimeOfDay(row.startedAt, endHours, endMinutes) : 0;
  const endedAt = row && endedAtRaw <= startedAt ? endedAtRaw + 24 * 60 * 60 * 1000 : endedAtRaw;
  const durationMs = row ? endedAt - startedAt : 0;

  async function handleSave() {
    if (!row || durationMs <= 0) return;
    setSaving(true);
    try {
      await onSave(row.localId, startedAt, endedAt);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
      <Dialog.Header>
        <div className="ui-dialog-sheet-handle" />
        <Text style={{ fontWeight: 650 }}>Edit {row?.kind === "travel" ? "travel" : "work"} time</Text>
        <IconButton variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
          <X aria-hidden />
        </IconButton>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="lg">
          <Text tone="muted">{row ? formatDateLabel(row.startedAt) : ""}</Text>

          <Stack gap="sm">
            <Text style={{ fontWeight: 600 }}>Start</Text>
            <div className="ui-wheel-picker">
              <div className="ui-wheel-picker-highlight" aria-hidden style={{ height: ITEM_HEIGHT, top: ITEM_HEIGHT }} />
              <WheelColumn values={HOURS} value={startHours} onChange={setStartHours} suffix="h" ariaLabel="Start hours" />
              <WheelColumn values={MINUTES} value={startMinutes} onChange={setStartMinutes} suffix="m" ariaLabel="Start minutes" />
            </div>
          </Stack>

          <Stack gap="sm">
            <Text style={{ fontWeight: 600 }}>End</Text>
            <div className="ui-wheel-picker">
              <div className="ui-wheel-picker-highlight" aria-hidden style={{ height: ITEM_HEIGHT, top: ITEM_HEIGHT }} />
              <WheelColumn values={HOURS} value={endHours} onChange={setEndHours} suffix="h" ariaLabel="End hours" />
              <WheelColumn values={MINUTES} value={endMinutes} onChange={setEndMinutes} suffix="m" ariaLabel="End minutes" />
            </div>
          </Stack>

          <Text tone="muted">Duration {formatClockHoursMinutes(durationMs)}</Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving || durationMs <= 0}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
