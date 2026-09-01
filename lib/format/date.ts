/**
 * Shared date/time display formatters (issue #83) — consolidates what were
 * 12+ near-identical local copies across Activities/Assets/Contracts/
 * Quotes/Work Orders/Clients (table components, detail pages, panels).
 * Callers that need a slightly different month style or omit the year pass
 * `options`; everything else stays the same shape every copy already used.
 */

/**
 * Formats a plain date string (e.g. "2026-08-29", no time component) for
 * display — parses it at local midnight (`${value}T00:00:00`) so it isn't
 * shifted a day by UTC-vs-local timezone conversion.
 */
export function formatDate(value: string | null, options?: { month?: "short" | "long" }): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: options?.month ?? "short", day: "numeric" });
}

/**
 * Formats a full timestamp (date + time) for display. `options.year: false`
 * drops the year (used where the surrounding context already makes the year
 * obvious, e.g. a running work order's time-entry list).
 */
export function formatDateTime(
  value: string | null | undefined,
  options?: { month?: "short" | "long"; year?: boolean },
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    ...(options?.year === false ? {} : { year: "numeric" as const }),
    month: options?.month ?? "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Fixed "dd-MM-yyyy HH:mm" timestamp (issue #113 follow-up) — for a precise,
 * log-style read-out (e.g. the Clients hero's "Last activity" stat) where
 * `formatDateTime`'s locale-dependent, month-name shape above reads as too
 * loose/ambiguous. Always this exact numeric form, independent of the
 * viewer's browser locale.
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
