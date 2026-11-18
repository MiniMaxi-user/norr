import type { ListArticlesOptions } from "../actions";

/** Rows per page of the Articles list. */
export const ARTICLES_PAGE_SIZE = 25;

/** Raw `?` params of `/articles` (all optional strings). `search` is the
 * pre-#222 name of `q`; `active` the pre-#222 status filter (`1`/`0`), kept
 * so existing deep links still work. */
export interface ArticlesSearchParams {
  q?: string;
  search?: string;
  groupId?: string;
  manufacturerItemId?: string;
  composite?: string;
  seg?: string;
  active?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/** Column id (URL `?sort=`) -> `listArticles` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListArticlesOptions["sort"]>> = {
  number: "article_number",
  description: "description",
  purchase: "purchase_price",
  sale: "sale_price",
};

/** Status toggle value: `active` (default), `inactive` or `all`. */
export function parseArticlesStatus(params: ArticlesSearchParams): "active" | "inactive" | "all" {
  if (params.seg === "inactive" || params.seg === "all" || params.seg === "active") return params.seg;
  if (params.active === "0") return "inactive";
  return "active";
}

/** Translates the list page's URL params into `listArticles` options. */
export function parseArticlesQuery(params: ArticlesSearchParams): {
  page: number;
  options: ListArticlesOptions;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const status = parseArticlesStatus(params);
  return {
    page,
    options: {
      limit: ARTICLES_PAGE_SIZE,
      offset: (page - 1) * ARTICLES_PAGE_SIZE,
      search: (params.q ?? params.search)?.trim() || undefined,
      groupId: params.groupId || undefined,
      manufacturerItemId: params.manufacturerItemId || undefined,
      isActive: status === "all" ? undefined : status === "active",
      isComposite: params.composite === "1" ? true : params.composite === "0" ? false : undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "desc" ? "desc" : "asc",
    },
  };
}
