"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, IconButton, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { X } from "@yourorg/ui/icons";

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 3;
const COLUMN_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** `{hours, minutes}` from a duration — used both to seed the picker's
 * starting position and (via the inverse in `EditHoursDialog`'s `handleSave`)
 * to turn the picker's selection back into a new `endedAt`. */
function msToHm(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** `"Friday 12 September"` — reused date-label shape as `today-screen.tsx`'s
 * `formatTodayDateLabel`, deliberately reimplemented rather than shared (see
 * that file's own note on why: no cross-file coupling for a one-liner). Shown
 * read-only in this dialog since the date itself is never editable here —
 * only the duration is. */
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
 * The Hours tab's swipe-to-edit correction sheet (product feedback,
 * 2026-09-13) — two scrollable hour/minute wheels set a new DURATION for the
 * row; `startedAt` (and the date it falls on) stays fixed, only how long the
 * period lasted is being corrected, so `endedAt` is recomputed as
 * `startedAt + duration` on Save.
 *
 * Remounted (via the `key` its call site passes) every time a different Edit
 * tap opens it — including re-opening the SAME row after a cancelled edit —
 * so its `hours`/`minutes` state always initializes fresh from `row` with a
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
  onSave: (localId: number, endedAt: number) => void | Promise<void>;
}) {
  useEscapeToClose(open, onOpenChange);

  const [hours, setHours] = useState(() => (row ? msToHm(row.endedAt - row.startedAt).hours : 0));
  const [minutes, setMinutes] = useState(() => (row ? msToHm(row.endedAt - row.startedAt).minutes : 0));
  const [saving, setSaving] = useState(false);

  const durationMs = hours * 3_600_000 + minutes * 60_000;

  async function handleSave() {
    if (!row || durationMs <= 0) return;
    setSaving(true);
    try {
      await onSave(row.localId, row.startedAt + durationMs);
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
        <Stack gap="md">
          <Text tone="muted">{row ? formatDateLabel(row.startedAt) : ""}</Text>
          <div className="ui-wheel-picker">
            <div className="ui-wheel-picker-highlight" aria-hidden style={{ height: ITEM_HEIGHT, top: ITEM_HEIGHT }} />
            <WheelColumn values={HOURS} value={hours} onChange={setHours} suffix="h" ariaLabel="Hours" />
            <WheelColumn values={MINUTES} value={minutes} onChange={setMinutes} suffix="m" ariaLabel="Minutes" />
          </div>
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
