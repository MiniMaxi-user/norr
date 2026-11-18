import type { QuoteRecord } from "../actions";

/** Days after expiry in which a still-open sent quote counts as "just expired". */
export const RECENTLY_EXPIRED_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** Today in Europe/Amsterdam as `YYYY-MM-DD`. */
export function todayAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);
}

export function pluralDays(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/** Quotes still in play: not yet decided or invoiced. */
export const OPEN_STATUS_VALUES = ["draft", "sent"];
export const isOpenQuote = (quote: Pick<QuoteRecord, "quote_status">) =>
  OPEN_STATUS_VALUES.includes(quote.quote_status?.value ?? "");

export type SentQuoteExpiry = "today" | "expired" | null;

/**
 * The one hard deadline a quote has: it was SENT and its validity ends today
 * ("today") or ended within the last 7 days without an answer ("expired").
 * Shared by the Client page's and the Quote page's LivePanel so both agree.
 */
export function sentQuoteExpiry(
  quote: Pick<QuoteRecord, "quote_status" | "is_auto_draft" | "valid_until">,
  today: string,
): SentQuoteExpiry {
  if (quote.quote_status?.value !== "sent" || quote.is_auto_draft || !quote.valid_until) return null;
  const age = daysBetween(quote.valid_until, today);
  if (age === 0) return "today";
  if (age > 0 && age <= RECENTLY_EXPIRED_DAYS) return "expired";
  return null;
}

/** Days left on an open quote's validity (negative once past); `null` when it
 * has no end date or is no longer open (accepted, rejected, invoiced...). */
export function validityDaysLeft(
  quote: Pick<QuoteRecord, "quote_status" | "valid_until">,
  today: string,
): number | null {
  if (!quote.valid_until || !isOpenQuote(quote)) return null;
  return daysBetween(today, quote.valid_until);
}
