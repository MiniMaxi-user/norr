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

/** The server only accepts `:00`/`:30` start times (planning-actions.ts), so
 * the grid snaps to half hours even though the DS asks for 15 minutes. */
export const SLOT_MINUTES = 30;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatHourLabel(hour: number): string {
  return `${pad(hour)}:00`;
}

/** The visible working-hours window of the Day view (whole hours, local). */
export interface WorkingHours {
  start: number;
  end: number;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { start: 8, end: 18 };

/** Presets of the header's "Working hours" dropdown (DS 07 section 1). */
export const WORKING_HOURS_PRESETS: readonly WorkingHours[] = [
  { start: 7, end: 17 },
  { start: 8, end: 18 },
  { start: 6, end: 20 },
];

/** URL / preference token for a window: `"08-18"`. */
export function workingHoursKey(hours: WorkingHours): string {
  return `${pad(hours.start)}-${pad(hours.end)}`;
}

export function parseWorkingHours(raw: string | null | undefined): WorkingHours | undefined {
  const match = raw ? /^(\d{2})-(\d{2})$/.exec(raw) : null;
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!(start >= 0 && end <= 24 && start < end)) return undefined;
  return { start, end };
}

/** `08:00–18:00` */
export function formatWorkingHours(hours: WorkingHours): string {
  return `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`;
}

export function totalSlots(hours: WorkingHours): number {
  return (hours.end - hours.start) * SLOTS_PER_HOUR;
}

export function hourLabels(hours: WorkingHours): string[] {
  return Array.from({ length: hours.end - hours.start }, (_, i) => formatHourLabel(hours.start + i));
}

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

// "en-GB" (not "nl-NL") — matches `invoice-pdf.tsx`/`invoice-actions.ts`'s own
// English-copy switch (issue #196): these format weekday/month names, so
// leaving them Dutch would leave Dutch text bleeding into the otherwise
// all-English Planning header/timeline.
const DAY_HEADING_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const WEEK_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const WEEK_END_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const WEEKDAY_ABBR_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DETAIL_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function formatDayHeading(date: Date): string {
  const label = DAY_HEADING_FORMAT.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** `16 Nov – 22 Nov 2026` */
export function formatWeekHeading(date: Date): string {
  const monday = startOfWeek(date);
  const sunday = addDays(monday, 6);
  return `${WEEK_DAY_FORMAT.format(monday)} – ${WEEK_END_FORMAT.format(sunday)}`;
}

/** `MON 16` overline label of a week column. */
export function formatWeekdayOverline(date: Date): string {
  return `${WEEKDAY_ABBR_FORMAT.format(date).toUpperCase()} ${date.getDate()}`;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isSameLocalDay(iso: string, date: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
}

/** Half-hour slot index (0-based from `hours.start`) for `iso`'s local
 * wall-clock time on `date`'s calendar day — `null` when `iso` falls on a
 * different day, outside the visible window, or off the half-hour grid. */
export function slotIndexFor(iso: string, date: Date, hours: WorkingHours): number | null {
  if (!isSameLocalDay(iso, date)) return null;
  const d = new Date(iso);
  const minutesFromStart = (d.getHours() - hours.start) * 60 + d.getMinutes();
  if (minutesFromStart < 0) return null;
  const slot = minutesFromStart / SLOT_MINUTES;
  if (!Number.isInteger(slot) || slot >= totalSlots(hours)) return null;
  return slot;
}

/** Minutes from `hours.start` on `date`'s calendar day for `iso` (may be
 * negative or past the window end), or `null` on a different day. */
export function minutesFromWindowStart(iso: string, date: Date, hours: WorkingHours): number | null {
  if (!isSameLocalDay(iso, date)) return null;
  const d = new Date(iso);
  return (d.getHours() - hours.start) * 60 + d.getMinutes();
}

/** The local `Date` for a given half-hour slot index on `date`'s calendar
 * day — the inverse of `slotIndexFor`. */
export function dateForSlot(date: Date, slotIndex: number, hours: WorkingHours): Date {
  const start = localMidnight(date);
  start.setMinutes(hours.start * 60 + slotIndex * SLOT_MINUTES);
  return start;
}

export function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `09:30` + minutes -> `11:30` (wall clock). */
export function formatEndTime(iso: string, durationMinutes: number): string {
  return formatTimeLabel(new Date(new Date(iso).getTime() + durationMinutes * 60_000).toISOString());
}

/** `"3 h"` / `"1.5 h"` — duration badge format. */
export function formatDurationHours(minutes: number): string {
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

/** `Thu 12:00` — the schedule toast. */
export function formatWeekdayTime(iso: string): string {
  return `${WEEKDAY_ABBR_FORMAT.format(new Date(iso))} ${formatTimeLabel(iso)}`;
}

/** `Thu 19 Nov` — the detail card. */
export function formatDetailDate(iso: string): string {
  return DETAIL_DATE_FORMAT.format(new Date(iso));
}
