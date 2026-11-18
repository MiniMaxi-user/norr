import type { ListContractsOptions } from "../actions";

/** Rows per page of the Contracts list. */
export const CONTRACTS_PAGE_SIZE = 25;

/** Raw `?` params of `/contracts` (all optional strings). `clientId`,
 * `typeId` and `slaTierId` are the dropdown ids (plain deep-link params). */
export interface ContractsSearchParams {
  page?: string;
  q?: string;
  clientId?: string;
  typeId?: string;
  slaTierId?: string;
  seg?: string;
  sort?: string;
  dir?: string;
}

/** URL param names of the Contracts list's dropdowns. */
export const CONTRACTS_DROPDOWN_IDS = {
  client: "clientId",
  type: "typeId",
  slaTier: "slaTierId",
} as const;

/** The 3-value toggle (All last): derived lifecycle. "Active" = running now;
 * contracts that have not started yet only show under "All". */
export const CONTRACTS_PHASE_SEGMENT = {
  label: "Status",
  defaultValue: "all",
  options: [
    { value: "active", label: "Active" },
    { value: "ended", label: "Ended" },
    { value: "all", label: "All" },
  ] as const,
};

/** Column id (URL `?sort=`) -> `listContracts` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListContractsOptions["sort"]>> = {
  number: "contract_number",
  start: "start_date",
  end: "end_date",
  nextInvoice: "next_invoice_date",
  value: "value",
};

/** Translates the list page's URL params into `listContracts` options (page
 * is 1-based in the URL). Unknown values are dropped; the server action
 * validates ids again. */
export function parseContractsQuery(params: ContractsSearchParams): {
  page: number;
  options: ListContractsOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return {
    page,
    options: {
      clientId: params.clientId || undefined,
      typeId: params.typeId || undefined,
      slaTierId: params.slaTierId || undefined,
      search: params.q?.trim() || undefined,
      phase: params.seg === "active" || params.seg === "ended" ? params.seg : undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "asc" ? "asc" : "desc",
      limit: CONTRACTS_PAGE_SIZE,
      offset: (page - 1) * CONTRACTS_PAGE_SIZE,
      includeUnfilteredCount: true,
    },
  };
}
