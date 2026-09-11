/**
 * Date/time helpers for the Planning module (issue #164) — kept in a plain
 * module (not `"use server"`), safe to import from both the Server
 * Component route (`page.tsx`, to compute the visible day/week's
 * `scheduledFrom`/`scheduledTo` bounds for `listWorkOrders`) and the
 * client-side scheduler board (`components/planning-grid.tsx`, to place
 * scheduled blocks on the half-hour grid and to build a new `scheduledAt`
 * when a drag/click schedules a backlog item).
 *
 * This app has no org-timezone model yet (grepped — nothing else in this
 * codebase does either); every date/time below is handled in whichever
 * timezone the running process (server or browser) is already in, same
 * "no timezone infra, don't pretend otherwise" stance
 * `app/(app)/work-orders/planning-actions.ts`'s own comments take. For a
 * server-rendered "today"/day-boundary computation this is a reasonable
 * simplification for this app's actual target market (Dutch business hours,
 * 08:00–18:00 local, sit comfortably inside a single UTC calendar day
 * regardless of CET/CEST) — flagged here rather than silently assumed.
 */

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 18;
export const SLOT_MINUTES = 30;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
export const TOTAL_SLOTS = (DAY_END_HOUR - DAY_START_HOUR) * SLOTS_PER_HOUR;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatHourLabel(hour: number): string {
  return `${pad(hour)}:00`;
}

export const HOUR_LABELS: string[] = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) =>
  formatHourLabel(DAY_START_HOUR + i),
);

/**
 * Builds an offset-aware ISO 8601 string (never a UTC `Z`) for a local
 * `Date` — matching the wall-clock-preserving convention
 * `app/(app)/work-orders/planning-actions.ts`'s `parseScheduledAt`/
 * `dayRangeFor` expect from every caller (see that file's own doc
 * comments): those helpers pull the wall-clock minute and UTC-offset suffix
 * straight out of the string itself, precisely so a caller's intended local
 * time survives instead of being silently normalized to UTC by
 * `Date.prototype.toISOString()`.
 */
export function toOffsetIsoString(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offsetH = pad(Math.floor(abs / 60));
  const offsetM = pad(abs % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${offsetH}:${offsetM}`
  );
}

/** Parses a `?date=YYYY-MM-DD` search param into a local midnight `Date`,
 * falling back to today (the running process's own local "today") for a
 * missing/malformed value. */
export function parseDateParam(raw: string | undefined): Date {
  if (raw) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match) {
      const [, y, m, d] = match;
      const candidate = new Date(Number(y), Number(m) - 1, Number(d));
      if (!Number.isNaN(candidate.getTime())) return candidate;
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function formatDateParam(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Monday-start week (Dutch/ISO convention). */
export function startOfWeek(date: Date): Date {
  const day = date.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function dayRangeIso(date: Date): { from: string; to: string } {
  const start = localMidnight(date);
  return { from: toOffsetIsoString(start), to: toOffsetIsoString(addDays(start, 1)) };
}

export function weekRangeIso(date: Date): { from: string; to: string } {
  const start = localMidnight(startOfWeek(date));
  return { from: toOffsetIsoString(start), to: toOffsetIsoString(addDays(start, 7)) };
}

const DAY_HEADING_FORMAT = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const WEEK_DAY_FORMAT = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const SHORT_WEEKDAY_FORMAT = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric" });

export function formatDayHeading(date: Date): string {
  const label = DAY_HEADING_FORMAT.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatWeekHeading(date: Date): string {
  const monday = startOfWeek(date);
  const sunday = addDays(monday, 6);
  return `${WEEK_DAY_FORMAT.format(monday)} – ${WEEK_DAY_FORMAT.format(sunday)}`;
}

export function formatShortWeekday(date: Date): string {
  const label = SHORT_WEEKDAY_FORMAT.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function isSameLocalDay(iso: string, date: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
}

/** Half-hour slot index (0-based from `DAY_START_HOUR`) for `iso`'s local
 * wall-clock time on `date`'s calendar day — `null` when `iso` falls on a
 * different day, outside the visible window, or off the half-hour grid. */
export function slotIndexFor(iso: string, date: Date): number | null {
  if (!isSameLocalDay(iso, date)) return null;
  const d = new Date(iso);
  const minutesFromStart = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
  if (minutesFromStart < 0) return null;
  const slot = minutesFromStart / SLOT_MINUTES;
  if (!Number.isInteger(slot) || slot >= TOTAL_SLOTS) return null;
  return slot;
}

/** The local `Date` for a given half-hour slot index on `date`'s calendar
 * day — the inverse of `slotIndexFor`. */
export function dateForSlot(date: Date, slotIndex: number): Date {
  const start = localMidnight(date);
  start.setMinutes(DAY_START_HOUR * 60 + slotIndex * SLOT_MINUTES);
  return start;
}

export function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `"3 u"` / `"1.5 u"` — matches the design mockup's duration badge format. */
export function formatDurationHours(minutes: number): string {
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} u`;
}
