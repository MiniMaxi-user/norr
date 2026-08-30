"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { articleCreateSchema, articleSearchSchema, articleUpdateSchema } from "./schema";
import { buildArticleSearchFilter } from "./search-filter";

/**
 * Server Actions for the Articles module (issue #92, "Artikel database") —
 * the product/part record itself. Article Groups and Article Components
 * (BOM) are sibling sub-resources kept in their own files
 * (`./groups-actions.ts`, `./components-actions.ts`), same "kept in its own
 * file rather than folded into `actions.ts`" split
 * `./work-orders/time-entries-actions.ts` / `./work-orders/checklist-actions.ts`
 * use.
 *
 * Same four-step preamble as every other module's actions (see the block
 * comment at the top of `app/(app)/clients/actions.ts`): resolve module
 * context (`hasFeature` + RBAC actor) -> `can()` -> Zod validation -> query
 * under the caller's own session (RLS is always the real backstop).
 *
 * RBAC recap for `articles` (lib/rbac/permissions.ts, matches
 * `supabase/migrations/20260829100000_articles_core.sql`'s RLS exactly):
 * `owner`/`administratie` = CRUD; `planner`/`engineer`/`finance` = plain
 * `read` (all rows, no `_own` scoping — shared master data). There is no gap
 * between `can()` and RLS to document here, unlike `assets.update` — every
 * action `can()` allows for a role is also allowed by RLS for that role.
 */

/** Resolved (embedded) shape of a `reference_list_items` row — same shape
 * `ResolvedReferenceItem` in `app/(app)/assets/actions.ts` uses for its own
 * `asset_type`/`asset_status` embeds. Not imported from there (that file has
 * no reason to be a dependency of this module) — duplicated on purpose, same
 * "small enough to redeclare per module" precedent `TimeEntryRecord` sets by
 * importing it from `./actions.ts` only because it's the SAME module family;
 * Articles is a different module entirely. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface ArticleComponentLineRecord {
  id: string;
  organization_id: string;
  parent_article_id: string;
  component_article_id: string;
  quantity: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded basic display fields for the component article — see
   * `getArticle` below. `null` should never actually happen (the DB FK has
   * no `on delete cascade` gap here — it DOES cascade, so a component row
   * can't outlive its component article), but modeled as nullable defensively
   * like every other embed in this codebase. */
  component_article: {
    id: string;
    article_number: string;
    description: string;
    image_url: string | null;
    is_active: boolean;
    unit_item_id: string;
    article_unit: ResolvedReferenceItem | null;
  } | null;
}

export interface ArticleRecord {
  id: string;
  organization_id: string;
  article_number: string;
  description: string;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  image_url: string | null;
  unit_item_id: string;
  manufacturer_item_id: string | null;
  group_id: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  vat_rate_item_id: string;
  is_composite: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!articles_unit_item_id_fkey(...)` —
   * see `ARTICLE_SELECT` below. */
  article_unit: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!articles_manufacturer_item_id_fkey(...)`.
   * `null` whenever `manufacturer_item_id` is `null`. */
  article_manufacturer: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!articles_vat_rate_item_id_fkey(...)`.
   * `value` is the literal numeric percentage as text ('0'/'9'/'21') — see
   * the migration's `vat_rate` seed comment. */
  vat_rate: ResolvedReferenceItem | null;
  /** Embedded via `article_groups!articles_group_id_fkey(id,name)`. `null`
   * whenever `group_id` is `null`. Shallow (id/name only) — same reasoning
   * `AssetRecord.asset_model` documents in `app/(app)/assets/actions.ts` for
   * why this doesn't also nest the group's own parent chain; the frontend
   * gets the full tree from `listArticleGroups()` in `./groups-actions.ts`
   * for any UI that needs it (e.g. a "Group > Subgroup" breadcrumb). */
  article_group: { id: string; name: string } | null;
}

/** Shared select shape for every query that returns an `ArticleRecord` — same
 * "resolve every FK label in one round trip" reasoning as `ASSET_SELECT` in
 * `app/(app)/assets/actions.ts`. FK constraint names confirmed live against
 * the linked project (`fxpjzcyeevtaadexnkub`) via direct
 * `select=*,x:table!<fk_name>(...)` REST calls (Postgres's default unnamed-FK
 * naming, `<table>_<column>_fkey`, for each column's inline `references`
 * clause in `20260829100000_articles_core.sql`). */
const ARTICLE_SELECT =
  "*, article_unit:reference_list_items!articles_unit_item_id_fkey(value,label,color), article_manufacturer:reference_list_items!articles_manufacturer_item_id_fkey(value,label,color), vat_rate:reference_list_items!articles_vat_rate_item_id_fkey(value,label,color), article_group:article_groups!articles_group_id_fkey(id,name)";

/** Select shape for an article's `article_components` BOM lines, each with
 * its component article's basic display fields (+ that component's own
 * resolved unit label) — see `getArticle` below. FK names same
 * live-confirmation as `ARTICLE_SELECT`. */
const ARTICLE_COMPONENT_SELECT =
  "*, component_article:articles!article_components_component_article_id_fkey(id,article_number,description,image_url,is_active,unit_item_id,article_unit:reference_list_items!articles_unit_item_id_fkey(value,label,color))";

const uuidSchema = z.string().uuid("Invalid id.");

function toArticleInsertRow(input: ReturnType<typeof articleCreateSchema.parse>, organizationId: string) {
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    article_number: input.articleNumber,
    description: input.description,
    ean: input.ean ?? null,
    gtin: input.gtin ?? null,
    mpn: input.mpn ?? null,
    image_url: input.imageUrl ?? null,
    manufacturer_item_id: input.manufacturerItemId ?? null,
    group_id: input.groupId ?? null,
    purchase_price: input.purchasePrice ?? null,
    sale_price: input.salePrice ?? null,
    is_composite: input.isComposite ?? false,
    is_active: input.isActive ?? true,
  };
  // unit_item_id/vat_rate_item_id are intentionally omitted (not even sent as
  // null) when not provided — the `derive_article_defaults` DB trigger fills
  // in the organization's default `article_unit`/`vat_rate` item on insert.
  // Same "let the DB default apply" treatment `toAssetInsertRow`'s
  // `status_id` gets in `app/(app)/assets/actions.ts`.
  if (input.unitItemId !== undefined) row.unit_item_id = input.unitItemId;
  if (input.vatRateItemId !== undefined) row.vat_rate_item_id = input.vatRateItemId;
  return row;
}

function toArticleUpdateRow(input: ReturnType<typeof articleUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.articleNumber !== undefined) row.article_number = input.articleNumber;
  if (input.description !== undefined) row.description = input.description;
  if (input.ean !== undefined) row.ean = input.ean ?? null;
  if (input.gtin !== undefined) row.gtin = input.gtin ?? null;
  if (input.mpn !== undefined) row.mpn = input.mpn ?? null;
  if (input.imageUrl !== undefined) row.image_url = input.imageUrl ?? null;
  if (input.unitItemId !== undefined) row.unit_item_id = input.unitItemId;
  if (input.manufacturerItemId !== undefined) row.manufacturer_item_id = input.manufacturerItemId ?? null;
  if (input.groupId !== undefined) row.group_id = input.groupId ?? null;
  if (input.purchasePrice !== undefined) row.purchase_price = input.purchasePrice ?? null;
  if (input.salePrice !== undefined) row.sale_price = input.salePrice ?? null;
  if (input.vatRateItemId !== undefined) row.vat_rate_item_id = input.vatRateItemId;
  if (input.isComposite !== undefined) row.is_composite = input.isComposite;
  if (input.isActive !== undefined) row.is_active = input.isActive;
  return row;
}

export interface ListArticlesOptions {
  /** Text search across `article_number`/`description`/`ean`/`gtin`/`mpn` —
   * see `buildArticleSearchFilter` above. */
  search?: string;
  groupId?: string;
  manufacturerItemId?: string;
  isActive?: boolean;
  isComposite?: boolean;
  limit?: number;
  offset?: number;
}

export async function listArticles(
  options: ListArticlesOptions = {},
): Promise<ActionResult<{ articles: ArticleRecord[]; count: number }>> {
  if (options.groupId !== undefined) {
    const groupIdResult = uuidSchema.safeParse(options.groupId);
    if (!groupIdResult.success) return fail("Invalid group filter.");
  }
  if (options.manufacturerItemId !== undefined) {
    const manufacturerIdResult = uuidSchema.safeParse(options.manufacturerItemId);
    if (!manufacturerIdResult.success) return fail("Invalid manufacturer filter.");
  }
  const searchResult = articleSearchSchema.safeParse(options.search);
  if (!searchResult.success) return fail("Invalid search term.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view articles.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("articles").select(ARTICLE_SELECT, { count: "exact" });
  if (searchResult.data) query = query.or(buildArticleSearchFilter(searchResult.data));
  if (options.groupId) query = query.eq("group_id", options.groupId);
  if (options.manufacturerItemId) query = query.eq("manufacturer_item_id", options.manufacturerItemId);
  if (options.isActive !== undefined) query = query.eq("is_active", options.isActive);
  if (options.isComposite !== undefined) query = query.eq("is_composite", options.isComposite);
  query = query.order("article_number", { ascending: true }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ articles: (data ?? []) as ArticleRecord[], count: count ?? 0 });
}

/** A single option for a "pick an article" `<select>` — e.g. the Travel-time/
 * Work-time article pickers on the Engineer (`lib/team/actions.ts`'s
 * `updateTeamMemberRateSettings`) and Client (`app/(app)/clients/actions.ts`'s
 * `updateClientRateSettings`) rate-settings forms, issue #93. Carries
 * `sale_price`/`purchase_price` so the caller can default-populate an
 * editable sale-price field and show a read-only purchase price the moment
 * an article is picked, without a second round trip. */
export interface ArticleSelectOption {
  id: string;
  article_number: string;
  description: string;
  /** Added for issue #95 (Quote line item inline editing) — the picker needs
   * to search by EAN/GTIN/MPN too, not just article number/description. */
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  sale_price: number | null;
  purchase_price: number | null;
  /** Added for issue #95 — resolved from `vat_rate_item_id` -> this org's
   * `vat_rate` reference list item's `value` (literal numeric percentage as
   * text, e.g. `'21'`) at read time, parsed to a number here so every caller
   * doesn't have to. `null` only defensively (the joined row or its `value`
   * failing to resolve/parse) — `articles.vat_rate_item_id` itself is
   * `not null`. */
  vat_rate_percent: number | null;
}

/** Raw row shape `listArticlesForSelect` selects off `articles`, before
 * `vat_rate` is flattened into `vat_rate_percent`. */
interface ArticleSelectRow {
  id: string;
  article_number: string;
  description: string;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  sale_price: number | null;
  purchase_price: number | null;
  vat_rate: { value: string } | null;
}

/**
 * Lightweight, unpaginated projection of every ACTIVE article in the
 * caller's org, for populating a plain `<select>`/combobox — deliberately
 * NOT `listArticles` above: that function is list-view-shaped (heavy FK
 * embeds via `ARTICLE_SELECT`, capped/paginated via `clampLimit`/`range`,
 * only 50 rows by default), which is the wrong shape for a dropdown that
 * needs every active article in one shot. Any active article is eligible —
 * no travel/work category or reference-list filter exists (or was asked
 * for) to narrow this further. Same RBAC gate as `listArticles` (`can(actor,
 * "articles", "read")` — every tenant role has at least read on Articles).
 *
 * Issue #95 (Quote line item inline editing) widened this projection to also
 * carry `ean`/`gtin`/`mpn` (so the article search/picker can match on those,
 * not just article number/description) and a resolved `vat_rate_percent`
 * (so a quote line item can display VAT the moment an article is picked,
 * without a second lookup). Still unpaginated/client-filtered on purpose —
 * this org's article catalog is small (issue #97's 50 mock rows), so a
 * single fetched list with client-side search filtering is the right shape
 * here, not a dedicated server-side search endpoint.
 */
export async function listArticlesForSelect(): Promise<ActionResult<{ articles: ArticleSelectOption[] }>> {
  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view articles.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id, article_number, description, ean, gtin, mpn, sale_price, purchase_price, vat_rate:reference_list_items!articles_vat_rate_item_id_fkey(value)",
    )
    .eq("is_active", true)
    .order("article_number", { ascending: true });

  if (error) return fail(mapDbError(error));

  const articles = ((data ?? []) as unknown as ArticleSelectRow[]).map((row) => ({
    id: row.id,
    article_number: row.article_number,
    description: row.description,
    ean: row.ean,
    gtin: row.gtin,
    mpn: row.mpn,
    sale_price: row.sale_price,
    purchase_price: row.purchase_price,
    vat_rate_percent: row.vat_rate ? parseVatRatePercent(row.vat_rate.value) : null,
  }));

  return ok({ articles });
}

/** Parses a `vat_rate` reference item's literal text `value` (e.g. `'21'`)
 * into a number, `null` on anything unparseable — defensive only, this
 * should never actually be non-numeric given the seeded `vat_rate` list. */
function parseVatRatePercent(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getArticle(
  id: string,
): Promise<ActionResult<{ article: ArticleRecord; components: ArticleComponentLineRecord[] }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view this article.");
  }

  const supabase = await createSupabaseServerClient();
  const [articleResult, componentsResult] = await Promise.all([
    supabase.from("articles").select(ARTICLE_SELECT).eq("id", idResult.data).maybeSingle(),
    // Only ever non-empty for a composite article (`is_composite = true`),
    // but queried unconditionally rather than branching on the article's own
    // flag first — a plain non-composite article simply has zero
    // `article_components` rows for `parent_article_id`, same "empty is a
    // valid state" treatment `getWorkOrderChecklist` gives its own
    // possibly-absent sub-resource in `app/(app)/work-orders/checklist-actions.ts`.
    supabase
      .from("article_components")
      .select(ARTICLE_COMPONENT_SELECT)
      .eq("parent_article_id", idResult.data)
      .order("created_at", { ascending: true }),
  ]);

  if (articleResult.error) return fail(mapDbError(articleResult.error));
  if (!articleResult.data) return fail("Article not found.");
  if (componentsResult.error) return fail(mapDbError(componentsResult.error));

  return ok({
    article: articleResult.data as ArticleRecord,
    components: (componentsResult.data ?? []) as ArticleComponentLineRecord[],
  });
}

export async function createArticle(input: unknown): Promise<ActionResult<{ article: ArticleRecord }>> {
  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "create")) {
    return fail("Only the organization owner or administratie can create articles.");
  }

  const parsed = articleCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("articles")
    .insert(toArticleInsertRow(parsed.data, ctx.context.organizationId))
    .select(ARTICLE_SELECT)
    .single();

  if (error) return fail(mapArticleDbError(error));
  return ok({ article: data as ArticleRecord });
}

export async function updateArticle(id: string, input: unknown): Promise<ActionResult<{ article: ArticleRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "update")) {
    return fail("Only the organization owner or administratie can update articles.");
  }

  const parsed = articleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toArticleUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("articles")
    .update(row)
    .eq("id", idResult.data)
    .select(ARTICLE_SELECT)
    .maybeSingle();

  if (error) return fail(mapArticleDbError(error));
  if (!data) return fail("Article not found, or you do not have permission to update it.");
  return ok({ article: data as ArticleRecord });
}

/** Maps a DB error from an `articles` write to a clean, user-safe message.
 * Adds the `23505` (unique_violation) case on top of the shared `mapDbError`
 * — `unique (organization_id, article_number)` — same "local error mapping on
 * top of the shared one" precedent `mapSiteDbError`/`mapChecklistDbError`
 * establish elsewhere in this codebase. */
function mapArticleDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "An article with this article number already exists.";
  }
  return mapDbError(error);
}

export interface ArticleDependencyCounts {
  /** Rows in `article_components` where this article is the
   * `component_article_id` — i.e. how many composite articles' BOMs include
   * this article. */
  usedAsComponentIn: number;
  /** Rows in `article_components` where this article is the
   * `parent_article_id` — i.e. this article's own BOM lines (only ever
   * non-zero for a composite article). */
  ownComponents: number;
}

/**
 * Dependency counts for the delete-confirmation UI, same
 * `getClientDependencyCounts` convention in `app/(app)/clients/actions.ts`.
 * Unlike that helper, `deleteArticle` below does not proceed past a non-zero
 * count — see its own comment for why a silent cascade isn't appropriate for
 * BOM data.
 */
export async function getArticleDependencyCounts(id: string): Promise<ActionResult<ArticleDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view this article.");
  }

  const supabase = await createSupabaseServerClient();
  const [usedAsComponentResult, ownComponentsResult] = await Promise.all([
    supabase
      .from("article_components")
      .select("id", { count: "exact", head: true })
      .eq("component_article_id", idResult.data),
    supabase.from("article_components").select("id", { count: "exact", head: true }).eq("parent_article_id", idResult.data),
  ]);

  if (usedAsComponentResult.error) return fail(mapDbError(usedAsComponentResult.error));
  if (ownComponentsResult.error) return fail(mapDbError(ownComponentsResult.error));

  return ok({
    usedAsComponentIn: usedAsComponentResult.count ?? 0,
    ownComponents: ownComponentsResult.count ?? 0,
  });
}

/**
 * Hard delete. Deliberately refuses (rather than cascading) when this
 * article is still in use — either as some composite's BOM component
 * (`usedAsComponentIn`), or as a composite article that still has its own BOM
 * lines (`ownComponents`) — call `getArticleDependencyCounts` first to show
 * the caller what's blocking it. This differs from `deleteClient`/`deleteSite`
 * in `app/(app)/clients/actions.ts`, which cascade sites/assets on purpose:
 * `article_components.parent_article_id`/`component_article_id` DO have `on
 * delete cascade` at the DB level (see the migration), so nothing would
 * technically stop this delete from silently wiping BOM lines out of other
 * composites' recipes — an app-layer refusal is the right call here since
 * that's real product/reporting data, not a disposable child record like a
 * site.
 */
export async function deleteArticle(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "delete")) {
    return fail("Only the organization owner or administratie can delete articles.");
  }

  const supabase = await createSupabaseServerClient();
  const [usedAsComponentResult, ownComponentsResult] = await Promise.all([
    supabase
      .from("article_components")
      .select("id", { count: "exact", head: true })
      .eq("component_article_id", idResult.data),
    supabase.from("article_components").select("id", { count: "exact", head: true }).eq("parent_article_id", idResult.data),
  ]);
  if (usedAsComponentResult.error) return fail(mapDbError(usedAsComponentResult.error));
  if (ownComponentsResult.error) return fail(mapDbError(ownComponentsResult.error));

  const usedAsComponentIn = usedAsComponentResult.count ?? 0;
  const ownComponents = ownComponentsResult.count ?? 0;
  if (usedAsComponentIn > 0) {
    return fail(
      `This article is used as a component in ${usedAsComponentIn} other composite article${usedAsComponentIn === 1 ? "" : "s"}. Remove it from ${usedAsComponentIn === 1 ? "that BOM" : "those BOMs"} first.`,
    );
  }
  if (ownComponents > 0) {
    return fail(
      `This composite article still has ${ownComponents} component${ownComponents === 1 ? "" : "s"} in its bill of materials. Remove them first.`,
    );
  }

  const { data, error } = await supabase
    .from("articles")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Article not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
