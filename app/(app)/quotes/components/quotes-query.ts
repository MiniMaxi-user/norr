import type { ListQuotesOptions } from "../actions";
import { OPEN_STATUS_VALUES } from "./quote-status";

/** Rows per page of the Quotes list. */
export const QUOTES_PAGE_SIZE = 25;

/** Raw `?` params of `/quotes` (all optional strings). `status`, `type` and
 * `clientId` are the dropdown ids; `status`/`type` also still accept the old
 * comma-separated lists (`?status=draft,sent`). `drafts=1` reveals the
 * system-managed auto-draft quotes (hidden by default, issue #109). */
export interface QuotesSearchParams {
  page?: string;
  q?: string;
  status?: string;
  type?: string;
  clientId?: string;
  drafts?: string;
  seg?: string;
  sort?: string;
  dir?: string;
}

/** URL param names of the Quotes list's dropdowns. */
export const QUOTES_DROPDOWN_IDS = {
  status: "status",
  type: "type",
  client: "clientId",
} as const;

/** The 3-value toggle (All last): open = still in play (`isOpenQuote`). */
export const QUOTES_OPEN_SEGMENT = {
  label: "Open or closed",
  defaultValue: "open",
  options: [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
  ] as const,
};

export const QUOTE_TYPE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "contract", label: "Contract" },
];

/** Column id (URL `?sort=`) -> `listQuotes` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListQuotesOptions["sort"]>> = {
  number: "quote_number",
  name: "name",
  valid: "valid_until",
  created: "created_at",
};

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Translates the list page's URL params into `listQuotes` options (page is
 * 1-based in the URL). Unknown values are dropped; the server action
 * validates again. */
export function parseQuotesQuery(params: QuotesSearchParams): {
  page: number;
  showDrafts: boolean;
  options: ListQuotesOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const showDrafts = params.drafts === "1";
  const seg = params.seg === "closed" || params.seg === "all" ? params.seg : "open";
  const status = parseList(params.status);
  const type = parseList(params.type).filter((value): value is "default" | "contract" =>
    QUOTE_TYPE_OPTIONS.some((option) => option.value === value),
  );
  // The Status dropdown and the Open/Closed toggle combine (AND). For "open"
  // that is the intersection; an empty intersection must match nothing (an
  // unknown value resolves to no status item, which `listQuotes` treats as
  // "match nothing").
  let statusFilter: string[] | undefined = status.length > 0 ? status : undefined;
  if (seg === "open") {
    if (!statusFilter) statusFilter = OPEN_STATUS_VALUES;
    else {
      const intersection = statusFilter.filter((value) => OPEN_STATUS_VALUES.includes(value));
      statusFilter = intersection.length > 0 ? intersection : ["__no_match__"];
    }
  }
  return {
    page,
    showDrafts,
    options: {
      clientId: params.clientId || undefined,
      status: statusFilter,
      excludeStatus: seg === "closed" ? OPEN_STATUS_VALUES : undefined,
      type: type.length > 0 ? type : undefined,
      isAutoDraft: showDrafts ? undefined : false,
      search: params.q?.trim() || undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "asc" ? "asc" : "desc",
      limit: QUOTES_PAGE_SIZE,
      offset: (page - 1) * QUOTES_PAGE_SIZE,
      includeUnfilteredCount: true,
    },
  };
}
