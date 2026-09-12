/**
 * Local-week ISO range helper for the profile sheet's "This week" hours
 * total (issue #170, IMPLEMENTATION.md §6). Same offset-aware ISO-string
 * approach as `lib/today-range.ts`'s `todayRangeIso()` (see that file's own
 * doc comment for why this is a deliberate, minimal reimplementation rather
 * than a shared import — apps/pwa can't reach across into the root app's
 * `app/` tree). Week starts Monday local time, same convention the root
 * app's Planning module uses for its own week view.
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

/** Offset-aware ISO range `[from, to)` for the current local Monday->next
 * Monday week, for filtering `started_at`. */
export function currentWeekRangeIso(): { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 (Sun) .. 6 (Sat)
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { from: toOffsetIsoString(start), to: toOffsetIsoString(end) };
}
