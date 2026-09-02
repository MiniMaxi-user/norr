"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import {
  quoteCreateSchema,
  quoteUpdateSchema,
  quoteLineItemCreateSchema,
  quoteLineItemUpdateSchema,
} from "./schema";

/**
 * Server Actions for the Quotes module (issue #16, second stage) — a new
 * top-level module (same tier as Clients/Assets/Work Orders/Contracts),
 * covering the `quotes` entity and its `quote_line_items` sub-list. Same
 * four-step preamble as every other module's actions (see the block comment
 * at the top of `app/(app)/clients/actions.ts`): resolve module context
 * (`hasFeature` + RBAC actor) -> `can()`/`canAny()` -> Zod validation ->
 * query under the caller's own session (RLS is always the real backstop).
 *
 * RBAC recap for `quotes` (lib/rbac/permissions.ts, matches
 * docs/ARCHITECTURE.md matrix): `owner`/`planner` have CRUD (all rows);
 * `engineer`/`finance`/`administratie` have plain `read` (all rows) — no
 * `_own`-suffixed actions on this module at all, same "no ownership concept"
 * shape `contracts` documents, just with a different pair of CRUD roles
 * (owner+planner here, owner+finance there — a quote isn't yet revenue, so it
 * sits at Work Orders' ops tier, not Contracts' finance tier).
 *
 * `supabase/migrations/20260824090000_quotes_core.sql` implements the
 * `quotes` matrix row directly in Postgres via `current_member_role`, on both
 * `quotes` and `quote_line_items`:
 *  - SELECT: any org member, all rows (no `_own` scoping to replicate).
 *  - INSERT/UPDATE/DELETE: owner or planner only
 *    (`current_member_role(organization_id) in ('owner', 'planner')`).
 * `can()`/`canAny()` here still matter independently of RLS agreeing: they
 * gate which actions exist at all for a role (correctly rejecting an
 * engineer's `createQuote`/`deleteQuote`/`createQuoteLineItem` attempt before
 * ever hitting the DB) and drive UI affordances.
 *
 * No app-layer pre-validation of `quote_line_items.assetId`'s cross-field
 * relationship to the quote's own `client_id` (mirrors `contracts`'
 * `linkContractAsset`/`contract_assets` trust boundary, NOT
 * `assets.subtypeId`'s app-layer shape pre-check) — the check is left
 * entirely to the `validate_quote_line_item_relations` DB trigger, whose
 * `23503`/`23514` is mapped to a clean message by `mapDbError`. Same
 * reasoning applies to `quotes.siteId`'s client-match check
 * (`validate_quote_relations`).
 *
 * **Total computation (no stored column, no N+1):** `quotes` deliberately has
 * no `total` column (see the migration's design note 2) — a quote's total is
 * `sum(quantity * unit_price * (1 - discount_percent / 100))` over its
 * `quote_line_items` (the discount factor folded in as of issue #95 — a
 * per-line discount that didn't actually move the grand total would be a
 * real pricing bug, not just a cosmetic display gap), computed here at the
 * application layer. Rather than a follow-up aggregate query per row (which
 * would N+1 `listQuotes`), every query that returns a `QuoteRecord` embeds
 * `quote_line_items(quantity, unit_price, discount_percent)` as a nested
 * PostgREST resource in the SAME select — a single round trip returns each
 * quote alongside its own line items' pricing columns, which `toQuoteRecord`
 * then reduces into a `total` field before the raw `quote_line_items` array
 * is stripped from the returned shape. This is the "single aggregate query"
 * option the hand-off notes call out, expressed as a nested select +
 * in-process reduce rather than a DB-side `sum()` — no second query, no
 * per-row query.
 *
 * *** Out of scope for this pass (flagged, not silently skipped): ***
 * converting an accepted quote into a Work Order/Contract
 * (`work_orders.source_quote_id` / `contracts.source_quote_id` already exist
 * as nullable FKs for this — see the migration's design note 6) is a
 * genuinely separate, larger piece (deciding what fields carry over, whether
 * line items become anything on the target side, etc.) and isn't part of
 * issue #16's core CRUD scope. A future `convertQuoteToWorkOrder`/
 * `convertQuoteToContract` action is the natural home for that logic.
 */

/** Resolved (embedded) shape of a `reference_list_items` row — mirrors
 * `ResolvedReferenceItem` in `app/(app)/contracts/actions.ts`/
 * `app/(app)/work-orders/actions.ts`; kept as a local copy rather than a
 * shared import, same "each module owns its own" pattern those files
 * establish. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface QuoteRecord {
  id: string;
  organization_id: string;
  client_id: string;
  site_id: string | null;
  name: string;
  status_id: string;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** True when this quote is the system-managed 1:1 shadow of a work order
   * (issue #109) — auto-created by `work_orders_create_auto_draft_quote` and
   * kept in sync with `time_entries`/`work_order_articles` until promoted
   * (`is_auto_draft -> false`, via `createQuoteFromWorkOrder`'s promotion
   * path in `app/(app)/work-orders/create-quote-actions.ts`). Already
   * selected here (part of `QUOTE_SELECT`'s `*`) — pulled into this
   * interface explicitly so `frontend-ui-engineer` can label/filter an
   * auto-draft quote on the `/quotes` list without an `as any` cast. A
   * still-`true` row is, by definition, not yet a "real" quote a human
   * decided to create — the frontend may want to hide these from the
   * default list view entirely, or badge them distinctly; left as a UI call,
   * not decided here. */
  is_auto_draft: boolean;
  /** Nullable FK into `work_orders` (issue #94 schema, `on delete set null`)
   * — set when this quote was created via a Work Order's "Create Quote"
   * button (including its own auto-draft, issue #109) rather than from
   * scratch. Already selected here (part of `QUOTE_SELECT`'s `*`) — pulled
   * into this interface explicitly (Quote detail redesign) so the detail
   * page can render a "Source" `RelationCard` linking back to
   * `/work-orders/[work_order_id]` when set. */
  work_order_id: string | null;
  /** Embedded via `reference_list_items!quotes_status_id_fkey(...)` — see
   * `QUOTE_SELECT` below. Postgres's default FK naming for an unnamed column
   * FK is `<table>_<column>_fkey` (same reasoning `app/(app)/contracts/
   * actions.ts`'s `CONTRACT_SELECT` comment documents). */
  quote_status: ResolvedReferenceItem | null;
  /** Computed, NOT a stored DB column — `sum(quantity * unit_price)` over
   * this quote's `quote_line_items`. See the module comment above for how
   * this is computed without N+1 queries. Rounded to 2 decimal places to
   * avoid floating-point summation artifacts. */
  total: number;
}

/** Lightweight embedded shape of a quote line item's linked article (issue
 * #95) — just enough for the inline-editable row to show read-only purchase
 * price and VAT without a second lookup. Embedded via
 * `articles!quote_line_items_article_id_fkey(...)` in `QUOTE_LINE_ITEM_SELECT`
 * below. Deliberately embedded via a join here rather than left for the
 * frontend to resolve against `listArticlesForSelect()`'s result: that
 * projection is active-articles-only, so it can't resolve a line item whose
 * linked article has since been deactivated — reading purchase_price/vat_rate
 * live off the actual linked article (regardless of its current `is_active`)
 * is the only shape that's always correct. */
export interface QuoteLineItemArticleEmbed {
  id: string;
  article_number: string;
  description: string;
  purchase_price: number | null;
  vat_rate: ResolvedReferenceItem | null;
}

export interface QuoteLineItemRecord {
  id: string;
  quote_id: string;
  organization_id: string;
  asset_id: string | null;
  /** Nullable FK into `articles` (issue #94 schema, issue #95 first real
   * consumer) — the source article this line item was generated/picked from,
   * for reporting traceability. `null` for a free-text/manual line item. */
  article_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** Per-line discount percentage, `numeric(5,2)` in `[0, 100]` (issue #95).
   * "Unit price incl. discount" = `unit_price * (1 - discount_percent / 100)`
   * and this line's total = `quantity * (that)` — both computed at the
   * application/display layer (frontend), same as `QuoteRecord.total`'s own
   * "no stored computed column" precedent below. */
  discount_percent: number;
  /** Nullable FK into `users` (issue #95) — which engineer a travel/work-
   * time-derived line item belongs to, for future reporting. `null` for
   * material/free-text line items. Not embedded with a resolved
   * name/email here — same "raw uuid, resolve via `listOrgMembers()`"
   * precedent `work_orders.assigned_to` already establishes (no
   * `WORK_ORDER_SELECT` user embed either); the frontend already has that
   * shared directory action to resolve a display name from this id. */
  engineer_user_id: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `articles!quote_line_items_article_id_fkey(...)` — see
   * `QUOTE_LINE_ITEM_SELECT` below. `null` whenever `article_id` is `null`. */
  article: QuoteLineItemArticleEmbed | null;
}

/** Raw shape of a `quote_line_items` row as embedded (nested select) under a
 * `quotes` row — just enough columns to compute `total`. */
interface EmbeddedQuoteLineItem {
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
}

/** Shared select shape for every query returning a `QuoteRecord`: resolves
 * `quote_status`'s value/label/color in the same round trip (same reasoning
 * as `CONTRACT_SELECT`/`WORK_ORDER_SELECT`), AND embeds each quote's own
 * `quote_line_items(quantity, unit_price)` so `total` can be computed without
 * a second query per row (see the module comment above). */
const QUOTE_SELECT =
  "*, quote_status:reference_list_items!quotes_status_id_fkey(value,label,color), quote_line_items(quantity,unit_price,discount_percent)";

/** Shared select shape for every query returning a `QuoteLineItemRecord` on
 * its own (create/update/list) — `*` covers every plain column (including
 * the issue #95 additions `article_id`/`discount_percent`/`engineer_user_id`)
 * plus the linked article's display fields (`QuoteLineItemArticleEmbed`,
 * see its own comment above for why this is a join rather than a
 * frontend-side `listArticlesForSelect()` lookup). `engineer_user_id` is
 * deliberately NOT resolved to a name/email here — see
 * `QuoteLineItemRecord.engineer_user_id`'s own comment. */
const QUOTE_LINE_ITEM_SELECT =
  "*, article:articles!quote_line_items_article_id_fkey(id,article_number,description,purchase_price,vat_rate:reference_list_items!articles_vat_rate_item_id_fkey(value,label,color))";

const uuidSchema = z.string().uuid("Invalid id.");

/** Sums `quantity * unit_price * (1 - discount_percent / 100)` across a
 * quote's embedded line items, rounded to 2 decimal places (money precision)
 * to avoid floating-point summation artifacts (e.g. `0.1 + 0.2 !== 0.3`) —
 * same rounding-to-cents spirit as `contracts.value`'s 2-decimal-place Zod
 * refine. `Number(...)` coercion guards against PostgREST/postgres returning
 * `numeric` columns as strings. */
function computeTotal(lineItems: readonly EmbeddedQuoteLineItem[] | null | undefined): number {
  const sum = (lineItems ?? []).reduce((acc, item) => {
    const discountFactor = 1 - Number(item.discount_percent) / 100;
    return acc + Number(item.quantity) * Number(item.unit_price) * discountFactor;
  }, 0);
  return Math.round(sum * 100) / 100;
}

/** Maps a raw `quotes` row (with its embedded `quote_status` and
 * `quote_line_items` nested selects) into the public `QuoteRecord` shape:
 * strips the raw `quote_line_items` array and replaces it with the computed
 * `total`. */
function toQuoteRecord(row: Record<string, unknown>): QuoteRecord {
  const { quote_line_items, ...rest } = row as { quote_line_items?: EmbeddedQuoteLineItem[] } & Record<
    string,
    unknown
  >;
  return { ...rest, total: computeTotal(quote_line_items) } as QuoteRecord;
}

function toQuoteInsertRow(input: ReturnType<typeof quoteCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    site_id: input.siteId ?? null,
    name: input.name,
    valid_until: input.validUntil ?? null,
    notes: input.notes ?? null,
  };
  // status_id is intentionally omitted (not even sent as null) when not
  // provided — the `derive_quote_organization_id` DB trigger fills in the
  // organization's default `quote_status` item on insert. Same reasoning as
  // `toContractInsertRow`'s `typeId` omission in
  // app/(app)/contracts/actions.ts.
  if (input.statusId !== undefined) row.status_id = input.statusId;
  return row;
}

function toQuoteUpdateRow(input: ReturnType<typeof quoteUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.siteId !== undefined) row.site_id = input.siteId ?? null;
  if (input.name !== undefined) row.name = input.name;
  if (input.statusId !== undefined) row.status_id = input.statusId;
  if (input.validUntil !== undefined) row.valid_until = input.validUntil ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

/** `articleId` (when set) is inserted as-is, with no server-side lookup of
 * the article's own description/sale_price to pre-fill `description`/
 * `unitPrice` — `description`/`unitPrice` stay required fields on this
 * schema regardless, and the frontend already has the full article row
 * (including `sale_price`) from the widened `listArticlesForSelect()`
 * (issue #95) the moment a user picks one in the search/combobox, so it can
 * populate both fields itself without a redundant round trip back to the
 * server. */
function toQuoteLineItemInsertRow(quoteId: string, input: ReturnType<typeof quoteLineItemCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    quote_id: quoteId,
    description: input.description,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    asset_id: input.assetId ?? null,
    article_id: input.articleId ?? null,
  };
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  // discount_percent is intentionally omitted (not even sent) when not
  // provided — the DB column's own `not null default 0` applies, same "let
  // the DB default apply" treatment `toQuoteInsertRow`'s `status_id`
  // omission documents.
  if (input.discountPercent !== undefined) row.discount_percent = input.discountPercent;
  if (input.engineerUserId !== undefined) row.engineer_user_id = input.engineerUserId ?? null;
  return row;
}

/** Already supports a true partial single-field update (e.g. just
 * `{ discountPercent: 15 }` for a per-cell inline-edit save-on-blur) — every
 * field here is independently optional both in `quoteLineItemUpdateSchema`
 * and in this row builder, so a caller only ever sends/writes the one field
 * that actually changed. No signature change was needed for issue #95's
 * inline-editing UI beyond adding the new fields themselves. */
function toQuoteLineItemUpdateRow(input: ReturnType<typeof quoteLineItemUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.description !== undefined) row.description = input.description;
  if (input.quantity !== undefined) row.quantity = input.quantity;
  if (input.unitPrice !== undefined) row.unit_price = input.unitPrice;
  if (input.assetId !== undefined) row.asset_id = input.assetId ?? null;
  if (input.articleId !== undefined) row.article_id = input.articleId ?? null;
  if (input.discountPercent !== undefined) row.discount_percent = input.discountPercent;
  if (input.engineerUserId !== undefined) row.engineer_user_id = input.engineerUserId ?? null;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface ListQuotesOptions {
  clientId?: string;
  statusId?: string;
  /** Issue #109 — filter to only auto-draft (`true`) or only "real"
   * (`false`) quotes. Omitted (`undefined`, the default) returns both, same
   * as before this filter existed — the frontend's default `/quotes` list
   * view should almost certainly pass `false` here to hide the
   * system-managed shadow quotes, but that choice is left to
   * `frontend-ui-engineer` rather than baked in as this function's default. */
  isAutoDraft?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Lists quotes, org-scoped via RLS automatically. Supports filtering by
 * `clientId`, `statusId`, and/or `isAutoDraft` (issue #109; all optional,
 * combinable), same pattern as `listContracts`/`listWorkOrders`. Each
 * returned `QuoteRecord` has its `total` computed from its own embedded
 * `quote_line_items` — no N+1 (see the module comment above).
 *
 * Default order: most-recently created first — there is no "what's next"
 * queue concept for quotes the way there is for work orders.
 */
export async function listQuotes(
  options: ListQuotesOptions = {},
): Promise<ActionResult<{ quotes: QuoteRecord[]; count: number }>> {
  for (const [label, value] of [
    ["client id filter", options.clientId],
    ["status id filter", options.statusId],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) {
      return fail(`Invalid ${label}.`);
    }
  }

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "quotes", ["read"])) {
    return fail("You do not have permission to view quotes.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("quotes").select(QUOTE_SELECT, { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.statusId) query = query.eq("status_id", options.statusId);
  if (options.isAutoDraft !== undefined) query = query.eq("is_auto_draft", options.isAutoDraft);
  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({
    quotes: (data ?? []).map((row) => toQuoteRecord(row as Record<string, unknown>)),
    count: count ?? 0,
  });
}

export async function getQuote(id: string): Promise<ActionResult<{ quote: QuoteRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "quotes", ["read"])) {
    return fail("You do not have permission to view this quote.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Quote not found.");
  return ok({ quote: toQuoteRecord(data as Record<string, unknown>) });
}

/** Owner/planner only (per the RBAC matrix + RLS INSERT policy, both agree —
 * engineer/finance/administratie have no `create` action in the matrix at
 * all, so there is no gap to document here the way there is for
 * `assets.update`). */
export async function createQuote(input: unknown): Promise<ActionResult<{ quote: QuoteRecord }>> {
  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "create")) {
    return fail("Only an owner or planner can create quotes.");
  }

  const parsed = quoteCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .insert(toQuoteInsertRow(parsed.data))
    .select(QUOTE_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ quote: toQuoteRecord(data as Record<string, unknown>) });
}

/** Owner/planner only (per the RBAC matrix + RLS UPDATE policy, both agree). */
export async function updateQuote(id: string, input: unknown): Promise<ActionResult<{ quote: QuoteRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "update")) {
    return fail("Only an owner or planner can update quotes.");
  }

  const parsed = quoteUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toQuoteUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .update(row)
    .eq("id", idResult.data)
    .select(QUOTE_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Quote not found, or you do not have permission to update it.");
  return ok({ quote: toQuoteRecord(data as Record<string, unknown>) });
}

/** Owner/planner only (per the RBAC matrix + RLS DELETE policy, both agree).
 * Hard delete. `quote_line_items.quote_id` has `on delete cascade` (see the
 * migration), so deleting a quote silently deletes its line items too;
 * `work_orders.source_quote_id`/`contracts.source_quote_id` are both `on
 * delete set null`, so any Work Order/Contract created by converting this
 * quote survives with `source_quote_id` cleared rather than being deleted. */
export async function deleteQuote(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "delete")) {
    return fail("Only an owner or planner can delete quotes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Quote not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

// ---------------------------------------------------------------------------
// Quote line items — gated on the same `quotes` RBAC module/feature as the
// quote record itself (not a separate matrix row), matching the DB's "if you
// can manage the quote, you can manage its line items" RLS boundary exactly
// (see the module comment above and the migration's RLS policies section).
// ---------------------------------------------------------------------------

/**
 * Lists a quote's line items, ordered by `sort_order`. Readable by anyone who
 * can read quotes at all (`read`), same as `listQuotes`/`getQuote` — the DB's
 * SELECT policy on `quote_line_items` is likewise "any org member", not
 * owner/planner-only (only the writes are restricted). Returns `total`
 * computed from the SAME fetched rows — no follow-up query needed here
 * either.
 */
export async function listQuoteLineItems(
  quoteId: string,
): Promise<ActionResult<{ lineItems: QuoteLineItemRecord[]; total: number }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "quotes", ["read"])) {
    return fail("You do not have permission to view this quote's line items.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .select(QUOTE_LINE_ITEM_SELECT)
    .eq("quote_id", idResult.data)
    .order("sort_order", { ascending: true });

  if (error) return fail(mapDbError(error));
  const lineItems = (data ?? []) as unknown as QuoteLineItemRecord[];
  return ok({ lineItems, total: computeTotal(lineItems) });
}

/**
 * Creates a line item on `quoteId`. Owner/planner only, matching the DB's
 * `quote_line_items_insert_owner_or_planner` policy exactly. `assetId` (when
 * set) must belong to the QUOTE's own `client_id` — enforced by the
 * `validate_quote_line_item_relations` DB trigger (not re-validated here; a
 * mismatch surfaces as a clean `mapDbError` `23514` message), same trust
 * boundary this module extends throughout (see the module comment above).
 */
export async function createQuoteLineItem(
  quoteId: string,
  input: unknown,
): Promise<ActionResult<{ lineItem: QuoteLineItemRecord }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "create")) {
    return fail("Only an owner or planner can add quote line items.");
  }

  const parsed = quoteLineItemCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .insert(toQuoteLineItemInsertRow(idResult.data, parsed.data))
    .select(QUOTE_LINE_ITEM_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ lineItem: data as unknown as QuoteLineItemRecord });
}

/**
 * Updates an existing line item. Owner/planner only, matching the DB's
 * `quote_line_items_update_owner_or_planner` policy. `quoteId` is not
 * updatable here (immutable after creation per the migration's design note 5
 * — `quote_line_items_update_owner_or_planner`'s column grant excludes
 * `quote_id`, and `quoteLineItemUpdateSchema` has no field for it at all).
 */
export async function updateQuoteLineItem(
  id: string,
  input: unknown,
): Promise<ActionResult<{ lineItem: QuoteLineItemRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid quote line item id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "update")) {
    return fail("Only an owner or planner can update quote line items.");
  }

  const parsed = quoteLineItemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toQuoteLineItemUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .update(row)
    .eq("id", idResult.data)
    .select(QUOTE_LINE_ITEM_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Quote line item not found, or you do not have permission to update it.");
  return ok({ lineItem: data as unknown as QuoteLineItemRecord });
}

/** Owner/planner only (per the `quotes` RBAC row + RLS DELETE policy, both
 * agree — engineer/finance/administratie have no `delete` action on `quotes`
 * at all, same "no gap to document" shape `deleteQuote` documents above). */
export async function deleteQuoteLineItem(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid quote line item id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "quotes", "delete")) {
    return fail("Only an owner or planner can delete quote line items.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Quote line item not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
