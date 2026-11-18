/**
 * Formatters for the web design system (issue #222, docs "Tekst en toon").
 *
 * Unlike the older `lib/format/date.ts` helpers (which pass `undefined` as the
 * locale and so can render differently on the server and in the browser),
 * everything here is fully deterministic: fixed month names, the
 * `Europe/Amsterdam` zone and a fixed number locale. That makes them safe to
 * call during render in client components without hydration mismatches.
 *
 * Never returns ISO strings or the text "null": an empty/invalid value is `—`.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const TIME_ZONE = "Europe/Amsterdam";

const dateTimeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const EMPTY_VALUE = "—";

/** `17 Nov 2026, 23:34` (Europe/Amsterdam). */
export function formatDateTimeWeb(value: string | Date | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const parts = Object.fromEntries(dateTimeParts.formatToParts(date).map((part) => [part.type, part.value]));
  const month = MONTHS[Number(parts.month) - 1] ?? "";
  return `${Number(parts.day)} ${month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** `17 Nov 2026` for a plain `YYYY-MM-DD` date (no timezone shift). */
export function formatDateWeb(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return EMPTY_VALUE;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return EMPTY_VALUE;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** `Nov 2026` — "Client since". */
export function formatMonthYearWeb(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(
    date,
  );
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${MONTHS[Number(map.month) - 1] ?? ""} ${map.year}`;
}

const money = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const moneyWhole = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** `€ 12.300,00`; pass `{ whole: true }` for `€ 12.300` (key figures). */
export function formatMoneyWeb(value: number | null | undefined, options?: { whole?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;
  return (options?.whole ? moneyWhole : money).format(value).replace(/ /g, " ");
}

const numberFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 3 });

/** `12.300` / `1.234,5` — deterministic counterpart of `formatNumber`. */
export function formatNumberWeb(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;
  return numberFormat.format(value);
}
