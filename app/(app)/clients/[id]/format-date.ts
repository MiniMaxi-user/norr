/**
 * Formats a plain date string (e.g. "2026-08-29", no time component) for
 * display — parses it at local midnight (`${value}T00:00:00`) so it isn't
 * shifted a day by UTC-vs-local timezone conversion. Shared by the Client
 * detail page's linked-records tabs (issue #78, Contracts/Quotes) — was
 * duplicated verbatim between `contracts-panel.tsx` and `quotes-panel.tsx`.
 */
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Formats a full timestamp (date + time) for display. Shared by the same
 * tabs as `formatDate` above (issue #78) — was `work-orders-panel.tsx`'s
 * own locally-named `formatScheduledAt`.
 */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
