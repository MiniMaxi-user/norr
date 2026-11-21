import type { ListAssetsOptions } from "../actions";

/** Rows per page of the Assets list. */
export const ASSETS_PAGE_SIZE = 25;

/** Raw `?` params of `/assets` (all optional strings). */
export interface AssetsSearchParams {
  view?: string;
  page?: string;
  q?: string;
  clientId?: string;
  siteId?: string;
  type?: string;
  status?: string;
  seg?: string;
  sort?: string;
  dir?: string;
  /** `1` = "Show inactive" (issue #274): assets with an inactive status are listed too. */
  inactive?: string;
}

/** Column id (URL `?sort=`) -> `listAssets` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListAssetsOptions["sort"]>> = {
  name: "name",
  serial: "serial_number",
  warranty: "warranty_until",
};

/** Translates the list page's URL params into `listAssets` options (page is
 * 1-based in the URL). Unknown values are dropped; the server action validates
 * ids again. */
export function parseAssetsQuery(params: AssetsSearchParams): {
  page: number;
  options: ListAssetsOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return {
    page,
    options: {
      clientId: params.clientId || undefined,
      siteId: params.siteId || undefined,
      search: params.q?.trim() || undefined,
      typeId: params.type || undefined,
      statusId: params.status || undefined,
      warranty: params.seg === "active" || params.seg === "expired" ? params.seg : undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "desc" ? "desc" : "asc",
      includeInactive: params.inactive === "1",
      limit: ASSETS_PAGE_SIZE,
      offset: (page - 1) * ASSETS_PAGE_SIZE,
    },
  };
}
