"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { articleSearchSchema } from "../articles/schema";
import { buildArticleSearchFilter } from "../articles/search-filter";
import {
  warehouseNameSchema,
  warehouseStockMinThresholdSchema,
  warehouseStockQuantitySchema,
} from "./schema";

/**
 * Server Actions for the Inventory / "Voorraad" module (issue #181, "[Story]
 * Locaties voorraad beheren" — first of a three-story sequence: this module,
 * #182 stock deduction from work orders, #180 not yet scoped). Schema
 * reference: `supabase/migrations/20260916090000_warehouses_and_stock.sql`
 * (`warehouses` — one auto-created per-engineer warehouse per org;
 * `warehouse_stock` — one row per article actually added to a warehouse).
 *
 * Same four-step preamble as every other module's actions (see
 * `app/(app)/articles/actions.ts`'s own header): resolve module context
 * (`hasFeature` + RBAC actor via `requireModuleContext`) -> `can()`/`canAny()`
 * -> Zod validation -> query under the caller's own session (RLS is always
 * the real backstop).
 *
 * RBAC recap for `inventory` (`packages/rbac/src/permissions.ts`, matches
 * the migration's RLS exactly): `owner`/`planner`/`administratie` = CRUD, all
 * rows; `finance` = plain `read`, all rows; `engineer` = `read_own` only (no
 * write at all — real quantity writes from the engineer side are a separate
 * PWA/system flow, issue #182). This file builds ONLY the beheerder-facing
 * (Owner/Planner/Administratie/Finance) overview + detail + stock-editing
 * actions — nothing here is reachable by an Engineer actor in practice (every
 * gate below checks the full, non-`_own` action, which `can()`/`canAny()`
 * never grants to `engineer` per the matrix above), matching the "Voorraad"
 * nav entry's own `requiredPermission: { module: "inventory", action: "read"
 * }` gate in `components/shell/nav-items.ts`.
 *
 * `warehouse_stock.total_consumed` is READ-ONLY from every action in this
 * file — never written here. It's excluded from this org's `warehouse_stock`
 * UPDATE column grant entirely (see the migration), and issue #182 is
 * expected to own writing it (a future `SECURITY DEFINER` trigger hooking
 * `work_order_articles`, alongside decrementing `quantity`). Likewise,
 * `last_counted_at` is written by exactly one action here
 * (`updateWarehouseStockQuantity`, the manual-count path) and by no other —
 * see that function's own comment.
 */

/** Resolved (embedded) shape of a `reference_list_items` row — same shape
 * `ResolvedReferenceItem` in `app/(app)/articles/actions.ts` uses for its own
 * `article_unit`/`vat_rate` embeds. Duplicated on purpose rather than
 * imported — Inventory is a different module entirely, same "small enough to
 * redeclare per module" precedent that file's own header documents. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

/** The warehouse's own engineer, embedded via
 * `users!warehouses_user_id_fkey(...)` — same "resolve every FK label in one
 * round trip" reasoning `ARTICLE_SELECT` documents in
 * `app/(app)/articles/actions.ts`. `null` only defensively (the FK has no
 * gap — `warehouses.user_id` is `not null` with `on delete cascade` — but
 * every embed in this codebase is still modeled nullable). */
export interface WarehouseEngineer {
  id: string;
  email: string;
  full_name: string | null;
}

export interface WarehouseRecord {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  engineer: WarehouseEngineer | null;
}

/** `listWarehouses`' per-row shape — the base `WarehouseRecord` plus figures
 * computed live at read time from that warehouse's `warehouse_stock` rows
 * joined to `articles`. Never stored (no stock VALUE column exists on either
 * table) — the exact "never snapshot, always read live" philosophy this
 * schema already applies to `work_order_articles`/`quote_line_items`
 * pricing, per the migration's own design note. */
export interface WarehouseListRecord extends WarehouseRecord {
  /** Count of `warehouse_stock` rows for this warehouse. */
  stockRowCount: number;
  /** `sum(quantity * articles.purchase_price)` across this warehouse's stock
   * rows, treating a `null` `purchase_price` as `0`. */
  totalPurchaseValue: number;
  /** `sum(quantity * articles.sale_price)` across this warehouse's stock
   * rows, treating a `null` `sale_price` as `0`. */
  totalSaleValue: number;
}

/** A `warehouse_stock` row's embedded `articles` display fields, via
 * `articles!warehouse_stock_article_id_fkey(...)`. FK constraint name is
 * Postgres's default unnamed-FK naming (`<table>_<column>_fkey`), same
 * confirmed convention `ARTICLE_SELECT`/`WORK_ORDER_ARTICLE_SELECT` already
 * rely on elsewhere in this codebase. */
export interface WarehouseStockArticle {
  id: string;
  article_number: string;
  description: string;
  unit_item_id: string;
  /** Embedded via `reference_list_items!articles_unit_item_id_fkey(...)`,
   * nested one level deeper than the rest of this shape — same nested-embed
   * pattern `ARTICLE_COMPONENT_SELECT`'s `component_article.article_unit`
   * uses in `app/(app)/articles/actions.ts`. */
  article_unit: ResolvedReferenceItem | null;
  purchase_price: number | null;
  sale_price: number | null;
}

export interface WarehouseStockRecord {
  id: string;
  organization_id: string;
  warehouse_id: string;
  article_id: string;
  user_id: string;
  quantity: number;
  min_threshold: number | null;
  /** Read-only from this module — see this file's header comment. */
  total_consumed: number;
  last_counted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  article: WarehouseStockArticle | null;
}

/** Lightweight row shape for the org-wide `warehouse_stock` query
 * `listWarehouses` uses purely to compute each warehouse's totals — NOT a
 * `WarehouseStockRecord` (deliberately not selecting `*`, since nothing but
 * `warehouse_id`/`quantity`/the two prices is needed for this aggregation). */
interface WarehouseStockValueRow {
  warehouse_id: string;
  quantity: number;
  article: { purchase_price: number | null; sale_price: number | null } | null;
}

const WAREHOUSE_SELECT = "*, engineer:users!warehouses_user_id_fkey(id,email,full_name)";

const WAREHOUSE_STOCK_SELECT =
  "*, article:articles!warehouse_stock_article_id_fkey(id,article_number,description,unit_item_id,purchase_price,sale_price,article_unit:reference_list_items!articles_unit_item_id_fkey(value,label,color))";

const uuidSchema = z.string().uuid("Invalid id.");

/** Sums `quantity * (purchase_price ?? 0)` / `quantity * (sale_price ?? 0)`
 * across a set of stock rows — shared by `listWarehouses` (per-warehouse
 * buckets) and `getWarehouse` (a single warehouse's total). */
function sumStockValue(rows: readonly { quantity: number; article: { purchase_price: number | null; sale_price: number | null } | null }[]): {
  totalPurchaseValue: number;
  totalSaleValue: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc.totalPurchaseValue += row.quantity * (row.article?.purchase_price ?? 0);
      acc.totalSaleValue += row.quantity * (row.article?.sale_price ?? 0);
      return acc;
    },
    { totalPurchaseValue: 0, totalSaleValue: 0 },
  );
}

/**
 * Overview page data: every warehouse in the org (one row per engineer),
 * each with its engineer's name/email and computed row count + stock value
 * figures. Unpaginated on purpose — cardinality is bounded by team size (one
 * warehouse per engineer membership), same "small, unpaginated" shape
 * `listArticlesForSelect` documents for its own bounded catalog projection
 * in `app/(app)/articles/actions.ts`.
 *
 * Two queries, not N+1: the second query fetches every `warehouse_stock` row
 * the caller's RLS allows (all rows for owner/planner/administratie/finance)
 * in one round trip, then buckets/aggregates them by `warehouse_id` in JS —
 * this stays O(1) round trips regardless of how many warehouses/stock rows
 * exist.
 */
export async function listWarehouses(): Promise<ActionResult<{ warehouses: WarehouseListRecord[] }>> {
  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "read")) {
    return fail("You do not have permission to view warehouses.");
  }

  const supabase = await createSupabaseServerClient();
  const [warehousesResult, stockResult] = await Promise.all([
    supabase.from("warehouses").select(WAREHOUSE_SELECT).order("name", { ascending: true }),
    supabase
      .from("warehouse_stock")
      .select("warehouse_id, quantity, article:articles!warehouse_stock_article_id_fkey(purchase_price,sale_price)"),
  ]);

  if (warehousesResult.error) return fail(mapDbError(warehousesResult.error));
  if (stockResult.error) return fail(mapDbError(stockResult.error));

  const buckets = new Map<string, WarehouseStockValueRow[]>();
  for (const row of (stockResult.data ?? []) as unknown as WarehouseStockValueRow[]) {
    const bucket = buckets.get(row.warehouse_id) ?? [];
    bucket.push(row);
    buckets.set(row.warehouse_id, bucket);
  }

  const warehouses = ((warehousesResult.data ?? []) as WarehouseRecord[]).map((warehouse) => {
    const bucket = buckets.get(warehouse.id) ?? [];
    const { totalPurchaseValue, totalSaleValue } = sumStockValue(bucket);
    return {
      ...warehouse,
      stockRowCount: bucket.length,
      totalPurchaseValue,
      totalSaleValue,
    };
  });

  return ok({ warehouses });
}

/**
 * Detail page data: the warehouse row (+ its engineer), every
 * `warehouse_stock` row it holds (+ each row's `articles` display fields),
 * and the same computed purchase/sale value totals as `listWarehouses`,
 * scoped to just this warehouse.
 */
export async function getWarehouse(warehouseId: string): Promise<
  ActionResult<{
    warehouse: WarehouseRecord;
    stock: WarehouseStockRecord[];
    totalPurchaseValue: number;
    totalSaleValue: number;
  }>
> {
  const idResult = uuidSchema.safeParse(warehouseId);
  if (!idResult.success) return fail("Invalid warehouse id.");

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "read")) {
    return fail("You do not have permission to view this warehouse.");
  }

  const supabase = await createSupabaseServerClient();
  const [warehouseResult, stockResult] = await Promise.all([
    supabase.from("warehouses").select(WAREHOUSE_SELECT).eq("id", idResult.data).maybeSingle(),
    supabase
      .from("warehouse_stock")
      .select(WAREHOUSE_STOCK_SELECT)
      .eq("warehouse_id", idResult.data)
      .order("created_at", { ascending: true }),
  ]);

  if (warehouseResult.error) return fail(mapDbError(warehouseResult.error));
  if (!warehouseResult.data) return fail("Warehouse not found.");
  if (stockResult.error) return fail(mapDbError(stockResult.error));

  const stock = (stockResult.data ?? []) as WarehouseStockRecord[];
  const { totalPurchaseValue, totalSaleValue } = sumStockValue(stock);

  return ok({
    warehouse: warehouseResult.data as WarehouseRecord,
    stock,
    totalPurchaseValue,
    totalSaleValue,
  });
}

/** Renames a warehouse. `organization_id`/`user_id` are insert-only per the
 * migration's own column grants — `name` is the only meaningfully-editable
 * field, so this is the only warehouse-level write action in this file. */
export async function updateWarehouseName(
  warehouseId: string,
  name: string,
): Promise<ActionResult<{ warehouse: WarehouseRecord }>> {
  const idResult = uuidSchema.safeParse(warehouseId);
  if (!idResult.success) return fail("Invalid warehouse id.");

  const nameResult = warehouseNameSchema.safeParse(name);
  if (!nameResult.success) {
    return fail("Please fix the highlighted fields.", {
      name: [nameResult.error.issues[0]?.message ?? "Invalid name."],
    });
  }

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "update")) {
    return fail("You do not have permission to rename this warehouse.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouses")
    .update({ name: nameResult.data })
    .eq("id", idResult.data)
    .select(WAREHOUSE_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Warehouse not found, or you do not have permission to update it.");
  return ok({ warehouse: data as WarehouseRecord });
}

export interface WarehouseArticleSearchResult {
  id: string;
  article_number: string;
  description: string;
  purchase_price: number | null;
  sale_price: number | null;
}

/**
 * Searches the org's ACTIVE article catalog for the "add article to
 * warehouse" flow, excluding any article that already has a `warehouse_stock`
 * row for this warehouse (so the picker never offers to double-add). Reuses
 * `articleSearchSchema`/`buildArticleSearchFilter` from
 * `app/(app)/articles/` as-is — the exact same ilike-across-`article_number`/
 * `description`/`ean`/`gtin`/`mpn` shape `listArticles`'s own `search` option
 * uses, and already explicitly exported for cross-module reuse (issue #95's
 * quote line-item picker does the same).
 *
 * Gated on `canAny(actor, "inventory", ["create", "update"])` — part of the
 * add-article flow, which itself is `create`-gated
 * (`addArticleToWarehouse`), but also reasonable to reach from an
 * update-oriented "manage this warehouse's stock" screen; both actions land
 * on the same Owner/Planner/Administratie set per the RBAC matrix, so this
 * is not a meaningfully wider gate in practice.
 */
export async function searchArticlesToAddToWarehouse(
  warehouseId: string,
  query: string,
): Promise<ActionResult<{ articles: WarehouseArticleSearchResult[] }>> {
  const idResult = uuidSchema.safeParse(warehouseId);
  if (!idResult.success) return fail("Invalid warehouse id.");

  const searchResult = articleSearchSchema.safeParse(query);
  if (!searchResult.success || !searchResult.data) {
    return fail("Please enter at least one character to search.");
  }

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "inventory", ["create", "update"])) {
    return fail("You do not have permission to add articles to a warehouse.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingStock, error: existingStockError } = await supabase
    .from("warehouse_stock")
    .select("article_id")
    .eq("warehouse_id", idResult.data);
  if (existingStockError) return fail(mapDbError(existingStockError));

  const excludedArticleIds = (existingStock ?? []).map((row) => row.article_id as string);

  let articlesQuery = supabase
    .from("articles")
    .select("id, article_number, description, purchase_price, sale_price")
    .eq("is_active", true)
    .or(buildArticleSearchFilter(searchResult.data))
    .order("article_number", { ascending: true })
    .limit(20);

  if (excludedArticleIds.length > 0) {
    articlesQuery = articlesQuery.not("id", "in", `(${excludedArticleIds.join(",")})`);
  }

  const { data, error } = await articlesQuery;
  if (error) return fail(mapDbError(error));

  return ok({ articles: (data ?? []) as WarehouseArticleSearchResult[] });
}

/** Maps a `warehouse_stock` write's DB error to a clean, user-safe message —
 * adds the `23505` (unique_violation) case on top of the shared `mapDbError`,
 * for `unique (warehouse_id, article_id)` — same "local error mapping on top
 * of the shared one" precedent `mapArticleDbError` establishes in
 * `app/(app)/articles/actions.ts`. */
function mapWarehouseStockDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "This article is already stocked in this warehouse.";
  }
  return mapDbError(error);
}

/**
 * Adds an article to a warehouse: inserts a `warehouse_stock` row at
 * `quantity: 0`, `last_counted_at` left `null` (no count has happened yet —
 * only `updateWarehouseStockQuantity` below ever sets it).
 */
export async function addArticleToWarehouse(
  warehouseId: string,
  articleId: string,
): Promise<ActionResult<{ warehouseStock: WarehouseStockRecord }>> {
  const warehouseIdResult = uuidSchema.safeParse(warehouseId);
  if (!warehouseIdResult.success) return fail("Invalid warehouse id.");

  const articleIdResult = uuidSchema.safeParse(articleId);
  if (!articleIdResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "create")) {
    return fail("You do not have permission to add articles to a warehouse.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .insert({
      warehouse_id: warehouseIdResult.data,
      article_id: articleIdResult.data,
      quantity: 0,
    })
    .select(WAREHOUSE_STOCK_SELECT)
    .single();

  if (error) return fail(mapWarehouseStockDbError(error));
  return ok({ warehouseStock: data as WarehouseStockRecord });
}

/** Removes an article from a warehouse (hard delete of its `warehouse_stock`
 * line) — no dependency check needed, unlike `deleteArticle` in
 * `app/(app)/articles/actions.ts`: a stock line is a disposable join row, not
 * referenced by anything else. */
export async function removeArticleFromWarehouse(warehouseStockId: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(warehouseStockId);
  if (!idResult.success) return fail("Invalid warehouse stock id.");

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "delete")) {
    return fail("You do not have permission to remove articles from a warehouse.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Stock line not found, or you do not have permission to remove it.");
  return ok({ deletedId: data.id as string });
}

/**
 * THE MANUAL COUNT PATH — the only write path in this codebase (today) that
 * touches `quantity`. Updates `quantity` AND stamps `last_counted_at =
 * now()` together, in the same statement, deliberately: per the migration's
 * design note 3, `last_counted_at` must be set ONLY when a human manually
 * corrects the on-hand count, and NEVER by issue #182's future automatic
 * consumption-deduction path (which will update `quantity`/`total_consumed`
 * via a narrower column list that excludes `last_counted_at`). Keeping this
 * action's own column list exactly `{ quantity, last_counted_at }` — nothing
 * more, nothing less — is what keeps that future split safe.
 *
 * Validates `quantity >= 0` server-side (matches
 * `warehouse_stock_quantity_non_negative`) so a bad value fails fast with a
 * friendly message rather than surfacing a raw DB constraint error.
 */
export async function updateWarehouseStockQuantity(
  warehouseStockId: string,
  quantity: number,
): Promise<ActionResult<{ warehouseStock: WarehouseStockRecord }>> {
  const idResult = uuidSchema.safeParse(warehouseStockId);
  if (!idResult.success) return fail("Invalid warehouse stock id.");

  const quantityResult = warehouseStockQuantitySchema.safeParse(quantity);
  if (!quantityResult.success) {
    return fail("Please fix the highlighted fields.", {
      quantity: [quantityResult.error.issues[0]?.message ?? "Invalid quantity."],
    });
  }

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "update")) {
    return fail("You do not have permission to update this warehouse's stock.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .update({ quantity: quantityResult.data, last_counted_at: new Date().toISOString() })
    .eq("id", idResult.data)
    .select(WAREHOUSE_STOCK_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Stock line not found, or you do not have permission to update it.");
  return ok({ warehouseStock: data as WarehouseStockRecord });
}

/**
 * Updates `min_threshold` only — does NOT touch `last_counted_at` (that
 * column is exclusively the manual-count path's concern, see
 * `updateWarehouseStockQuantity` above). `minThreshold: null` clears the
 * threshold; a number sets it (`>= 0`, matching
 * `warehouse_stock_min_threshold_non_negative`).
 */
export async function updateWarehouseStockThreshold(
  warehouseStockId: string,
  minThreshold: number | null,
): Promise<ActionResult<{ warehouseStock: WarehouseStockRecord }>> {
  const idResult = uuidSchema.safeParse(warehouseStockId);
  if (!idResult.success) return fail("Invalid warehouse stock id.");

  const thresholdResult = warehouseStockMinThresholdSchema.safeParse(minThreshold);
  if (!thresholdResult.success) {
    return fail("Please fix the highlighted fields.", {
      minThreshold: [thresholdResult.error.issues[0]?.message ?? "Invalid minimum threshold."],
    });
  }

  const ctx = await requireModuleContext("inventory");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "inventory", "update")) {
    return fail("You do not have permission to update this warehouse's stock.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .update({ min_threshold: thresholdResult.data })
    .eq("id", idResult.data)
    .select(WAREHOUSE_STOCK_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Stock line not found, or you do not have permission to update it.");
  return ok({ warehouseStock: data as WarehouseStockRecord });
}
