/** `/api/inventory/my-stock` response item — the PWA "Voorraad" profile
 * view (issue #182). Deliberately has NO price/value field at all (AC:
 * "Engineer ziet geen prijs") — this is enforced by the route's own
 * `select()` never fetching `purchase_price`/`sale_price`, not by omitting
 * them here after the fact. */
export interface MyStockItem {
  /** `warehouse_stock.id` — this stock line's own id. */
  id: string;
  articleId: string;
  articleNumber: string;
  description: string;
  /** `article_unit` reference-list label, e.g. "Stuk"/"Liter"/"Kg". Never
   * null in practice (`articles.unit_item_id` is required), but the join
   * can still resolve to `null` if a unit item was ever deleted out from
   * under an article, so this stays nullable defensively. */
  unit: string | null;
  /** Current on-hand quantity — included even when 0 (AC: "ook als
   * voorraad 0 is"). */
  quantity: number;
  /** `warehouse_stock.min_threshold`, surfaced to the engineer as "gewenste
   * voorraad" (desired stock) — the closest existing field to that AC
   * concept; there is no separate "desired" column (see issue #182's
   * hand-off notes). `null` when no threshold has been set. */
  minThreshold: number | null;
  lastCountedAt: string | null;
}

export interface MyStockResponse {
  stock: MyStockItem[];
}
