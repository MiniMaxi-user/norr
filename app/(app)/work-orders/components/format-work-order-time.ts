/** Shared small time-of-day formatters for the redesigned work order screen
 * (issue #102) — "07:10", "4:35", "€ 214.60"-adjacent duration/clock display
 * used by the Hours row list, the header's stat strip, and the Checklist row
 * list. Deliberately local to this module (not promoted to
 * `lib/format/date.ts`) — every existing formatter there renders a full
 * date, and these three only ever render alongside a work order's own
 * already-dated context, matching `time-entries-panel.tsx`'s own precedent
 * of owning small local time helpers rather than sharing them. */

export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Total elapsed minutes between two ISO datetimes, or `null` for a still-
 * running entry (`endedAt: null`) or an invalid range. */
export function elapsedMinutes(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

/** "4:35" (hours:minutes, no leading zero on the hour) — the work order
 * hero's own duration format, distinct from `time-entries-panel.tsx`'s old
 * "4h 35m" table-cell format (issue #102's mockup uses the former
 * throughout). */
export function formatHoursMinutes(totalMinutes: number | null): string {
  if (totalMinutes === null) return "—";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
