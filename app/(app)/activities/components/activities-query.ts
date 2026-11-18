import type { ListActivitiesOptions } from "../actions";

/** Rows per page of the Activities list. */
export const ACTIVITIES_PAGE_SIZE = 25;

/** Raw `?` params of `/activities` (all optional strings). `clientId`,
 * `statusId`, `typeId` and `actionHolderId` are the pre-#222 deep-link
 * params and double as the FilterBar dropdown ids. */
export interface ActivitiesSearchParams {
  q?: string;
  clientId?: string;
  statusId?: string;
  typeId?: string;
  actionHolderId?: string;
  seg?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/** Column id (URL `?sort=`) -> `listActivities` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListActivitiesOptions["sort"]>> = {
  description: "description",
  reported: "reported_at",
};

/** Open / Completed / All toggle value; default `open`. */
export function parseActivitiesCompletion(params: ActivitiesSearchParams): "open" | "completed" | "all" {
  if (params.seg === "open" || params.seg === "completed" || params.seg === "all") return params.seg;
  return "open";
}

/** Translates the list page's URL params into `listActivities` options. */
export function parseActivitiesQuery(params: ActivitiesSearchParams): {
  page: number;
  options: ListActivitiesOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const completion = parseActivitiesCompletion(params);
  const sort = params.sort ? SORT_BY_COLUMN[params.sort] : undefined;
  return {
    page,
    options: {
      limit: ACTIVITIES_PAGE_SIZE,
      offset: (page - 1) * ACTIVITIES_PAGE_SIZE,
      search: params.q?.trim() || undefined,
      clientId: params.clientId || undefined,
      statusId: params.statusId || undefined,
      typeId: params.typeId || undefined,
      actionHolderId: params.actionHolderId || undefined,
      completion: completion === "all" ? undefined : completion,
      sort,
      // No `sort` param = the default order (reported, newest first).
      direction: sort ? (params.dir === "desc" ? "desc" : params.dir === "asc" ? "asc" : undefined) : undefined,
    },
  };
}
