import type { WorkOrderArticleRecord } from "../work-order-articles-actions";

/** A consumed article's sales price on this work order: 0 when its contract
 * covers the article (issue #208), otherwise the article's own live price. */
export function effectiveSalePrice(row: WorkOrderArticleRecord): number | null {
  if (row.covered_by_contract) return 0;
  return row.article?.sale_price ?? null;
}
