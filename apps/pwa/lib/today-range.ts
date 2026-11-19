/**
 * Local-day ISO range helper for "today" queries (issue #169, PWA
 * work-order-overview). Mirrors the root app's
 * `app/(app)/planning/date-utils.ts` `dayRangeIso()`/`toOffsetIsoString()`
 * exactly (offset-aware ISO strings for local midnight -> next local
 * midnight, never normalized to UTC) so "today" means the same thing across
 * both apps. Not imported directly from that file — it lives in a separate
 * Next.js project (apps/pwa can't reach root's `app/` tree) — so this is a
 * deliberate, minimal reimplementation of just the piece this route needs.
 *
 * Same "no org-timezone model yet" caveat as the root file: every date/time
 * here is handled in whichever timezone the running server process is
 * already in.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toOffsetIsoString(date: Date): string {
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

/** Offset-aware ISO range `[from, to)` for today's local calendar day (local
 * midnight -> next local midnight), for filtering `scheduled_at`. */
export function todayRangeIso(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: toOffsetIsoString(start), to: toOffsetIsoString(end) };
}

/** How many days either side of today the Today screen can navigate (#229). */
export const DAY_NAV_RANGE = 3;

/** `YYYY-MM-DD` for the local calendar day of `date`. */
export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a strict `YYYY-MM-DD` into a local-midnight Date, or `null` when the
 * format is wrong or the date doesn't exist (e.g. 2026-02-31). */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** The local day `offset` days from today, as `YYYY-MM-DD`. */
export function dateStringForOffset(offset: number, now: Date = new Date()): string {
  return toLocalDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

/** Whole days between today and `value` (negative = past), or `null` when
 * `value` isn't a valid date. Calendar-day arithmetic, DST-safe. */
export function dayOffsetFromToday(value: string, now: Date = new Date()): number | null {
  const date = parseLocalDate(value);
  if (!date) return null;
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dateUtc - todayUtc) / 86_400_000);
}

/** True for a valid date within today-3 ... today+3. */
export function isDateInNavRange(value: string, now: Date = new Date()): boolean {
  const offset = dayOffsetFromToday(value, now);
  return offset !== null && Math.abs(offset) <= DAY_NAV_RANGE;
}

/** Offset-aware ISO range `[from, to)` for the local calendar day `date`
 * (`YYYY-MM-DD`); `null` for an invalid date. */
export function dayRangeIso(date: string): { from: string; to: string } | null {
  const start = parseLocalDate(date);
  if (!start) return null;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { from: toOffsetIsoString(start), to: toOffsetIsoString(end) };
}
