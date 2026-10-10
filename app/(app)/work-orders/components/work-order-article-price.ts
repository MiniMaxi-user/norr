import type { WorkOrderArticleRecord } from "../work-order-articles-actions";

/** A consumed article's sales price on this work order: the price frozen on
 * its synced quote line when it was logged/changed (contract coverage
 * applied at that moment, issue #208), falling back to the article's own
 * price only when no synced line exists. */
export function effectiveSalePrice(row: WorkOrderArticleRecord): number | null {
  return row.quoted_unit_price ?? row.article?.sale_price ?? null;
}
