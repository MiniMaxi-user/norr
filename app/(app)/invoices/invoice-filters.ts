import type { ListInvoicesFilters } from "./actions";

/**
 * Filter + sort builder shared by `listInvoices` (`./actions.ts`) and the CSV
 * export route (`./export.csv/route.ts`), so both always apply the same rules
 * to the `invoice_overview` view. Not a "use server" file.
 */

/** Strips characters that would break a PostgREST `or()`/`ilike` pattern. */
export function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()%*\\"':]/g, " ").replace(/ +/g, " ").trim().slice(0, 80);
}

interface FilterableQuery {
  gte(column: string, value: string): unknown;
  lte(column: string, value: string): unknown;
  eq(column: string, value: string): unknown;
  in(column: string, values: string[]): unknown;
  or(filters: string): unknown;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): unknown;
}

/** Period, client, quote type, payment status and search filters (no paging). */
export function applyInvoiceFilters<Q>(
  query: Q,
  f: Pick<ListInvoicesFilters, "from" | "to" | "clientId" | "quoteType" | "paymentStatuses" | "search">,
): Q {
  // The PostgREST builder returns a new typed builder per call; chain loosely.
  let q = query as unknown as FilterableQuery;
  if (f.from) q = q.gte("invoice_date", f.from) as FilterableQuery;
  if (f.to) q = q.lte("invoice_date", f.to) as FilterableQuery;
  if (f.clientId) q = q.eq("client_id", f.clientId) as FilterableQuery;
  if (f.quoteType) q = q.eq("quote_type", f.quoteType) as FilterableQuery;
  if (f.paymentStatuses && f.paymentStatuses.length > 0) q = q.in("payment_status", f.paymentStatuses) as FilterableQuery;
  const term = sanitizeSearchTerm(f.search ?? "");
  if (term) q = q.or(`invoice_number.ilike.%${term}%,client_name.ilike.%${term}%`) as FilterableQuery;
  return q as unknown as Q;
}

/** Sort (default: newest invoice date first), with invoice number and id as tie-breakers. */
export function applyInvoiceSort<Q>(query: Q, f: Pick<ListInvoicesFilters, "sort" | "direction">): Q {
  let q = query as unknown as FilterableQuery;
  const sort = f.sort ?? "invoice_date";
  const ascending = (f.direction ?? "desc") === "asc";
  q = q.order(sort, { ascending, nullsFirst: false }) as FilterableQuery;
  if (sort !== "invoice_number") q = q.order("invoice_number", { ascending }) as FilterableQuery;
  q = q.order("id") as FilterableQuery;
  return q as unknown as Q;
}
