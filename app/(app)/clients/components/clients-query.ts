import type { ListClientsOptions } from "../actions";

/** Rows per page of the Clients list. */
export const CLIENTS_PAGE_SIZE = 25;

/** Raw `?` params of `/clients` (all optional strings). */
export interface ClientsSearchParams {
  view?: string;
  page?: string;
  q?: string;
  status?: string;
  am?: string;
  seg?: string;
  sort?: string;
  dir?: string;
}

/** Column id (URL `?sort=`) -> `listClients` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListClientsOptions["sort"]>> = {
  name: "name",
  status: "status",
  potential: "potential_value",
  since: "created_at",
};

/** Translates the list page's URL params into `listClients` options. Unknown
 * values are dropped (the server action validates again). */
export function parseClientsQuery(params: ClientsSearchParams): {
  page: number;
  options: ListClientsOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return {
    page,
    options: {
      limit: CLIENTS_PAGE_SIZE,
      offset: (page - 1) * CLIENTS_PAGE_SIZE,
      includePrimarySite: true,
      search: params.q?.trim() || undefined,
      status: params.status || undefined,
      accountManagerId: params.am || undefined,
      potential: params.seg === "set" || params.seg === "unset" ? params.seg : undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "desc" ? "desc" : "asc",
    },
  };
}
