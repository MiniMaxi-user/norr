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
