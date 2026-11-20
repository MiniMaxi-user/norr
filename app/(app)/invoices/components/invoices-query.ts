import type { InvoicePaymentStatusValue, ListInvoicesFilters } from "../actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows per page of the Invoices list. */
export const INVOICES_PAGE_SIZE = 25;

/** Raw `?` params of `/invoices` (all optional strings). `status` is a
 * comma-separated multiselect; `period`, `type` and `clientId` are dropdown ids. */
export interface InvoicesSearchParams {
  page?: string;
  q?: string;
  status?: string;
  type?: string;
  clientId?: string;
  period?: string;
  seg?: string;
  sort?: string;
  dir?: string;
}

export const INVOICES_DROPDOWN_IDS = {
  period: "period",
  status: "status",
  type: "type",
  client: "clientId",
} as const;

export const INVOICE_TYPE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "contract", label: "Contract" },
];

export const UNPAID_STATUSES: InvoicePaymentStatusValue[] = ["open", "partially_paid", "overdue"];
const SETTLED_STATUSES: InvoicePaymentStatusValue[] = ["paid", "credited", "credit_note"];
const ALL_STATUSES: InvoicePaymentStatusValue[] = [...UNPAID_STATUSES, ...SETTLED_STATUSES];

/** The 3-value toggle (All last). */
export const INVOICES_SEGMENT = {
  label: "Unpaid or settled",
  defaultValue: "all",
  options: [
    { value: "unpaid", label: "Unpaid" },
    { value: "settled", label: "Settled" },
    { value: "all", label: "All" },
  ] as const,
};

export const INVOICE_PERIOD_OPTIONS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
];

/** Column id (URL `?sort=`) -> `listInvoices` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListInvoicesFilters["sort"]>> = {
  number: "invoice_number",
  date: "invoice_date",
  due: "due_date",
  subtotal: "subtotal",
  total: "total",
  client: "client_name",
};

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Inclusive `from`/`to` (YYYY-MM-DD) of a period preset, relative to `now`. */
export function periodRange(period: string | undefined, now: Date = new Date()): { from?: string; to?: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarterStart = Math.floor(month / 3) * 3;
  switch (period) {
    case "this_month":
      return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month + 1, 0)) };
    case "last_month":
      return { from: iso(new Date(year, month - 1, 1)), to: iso(new Date(year, month, 0)) };
    case "this_quarter":
      return { from: iso(new Date(year, quarterStart, 1)), to: iso(new Date(year, quarterStart + 3, 0)) };
    case "last_quarter":
      return { from: iso(new Date(year, quarterStart - 3, 1)), to: iso(new Date(year, quarterStart, 0)) };
    case "this_year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last_year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default:
      return {};
  }
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Translates the list page's URL params into `listInvoices` filters (page is
 * 1-based in the URL). Unknown values are dropped; the server action
 * validates again. */
export function parseInvoicesQuery(params: InvoicesSearchParams): {
  page: number;
  period: string | undefined;
  filters: ListInvoicesFilters;
  /** The status filters contradict each other: the list is empty by definition. */
  noMatch: boolean;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const period = INVOICE_PERIOD_OPTIONS.some((option) => option.value === params.period) ? params.period : undefined;
  const seg = params.seg === "unpaid" || params.seg === "settled" ? params.seg : "all";
  const picked = parseList(params.status).filter((value): value is InvoicePaymentStatusValue =>
    ALL_STATUSES.includes(value as InvoicePaymentStatusValue),
  );
  // The Status multiselect and the Unpaid/Settled toggle combine (AND); an
  // empty intersection must match nothing.
  let statuses: InvoicePaymentStatusValue[] | undefined = picked.length > 0 ? picked : undefined;
  if (seg !== "all") {
    const allowed = seg === "unpaid" ? UNPAID_STATUSES : SETTLED_STATUSES;
    statuses = statuses ? statuses.filter((value) => allowed.includes(value)) : allowed;
  }
  const type = params.type === "default" || params.type === "contract" ? params.type : undefined;
  const range = periodRange(period);
  return {
    page,
    period,
    noMatch: Boolean(statuses && statuses.length === 0),
    filters: {
      from: range.from,
      to: range.to,
      // An invalid id in the URL is dropped like other unknown params.
      clientId: params.clientId && UUID_RE.test(params.clientId) ? params.clientId : undefined,
      paymentStatuses: statuses && statuses.length > 0 ? statuses : undefined,
      quoteType: type,
      search: params.q?.trim() || undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : "invoice_date",
      direction: params.dir === "asc" ? "asc" : "desc",
      limit: INVOICES_PAGE_SIZE,
      offset: (page - 1) * INVOICES_PAGE_SIZE,
    },
  };
}

/** E-invoice export URLs (issue #241), kept in one place. */
export const invoiceUblUrl = (invoiceId: string) => `/invoices/${invoiceId}/ubl`;
export const INVOICES_EXPORT_CSV_URL = "/invoices/export.csv";
