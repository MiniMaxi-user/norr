"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { articleComponentAddSchema, articleComponentUpdateSchema } from "./schema";
import type { ArticleComponentLineRecord } from "./actions";
import {
  buildArticleComponentTree,
  type ArticleComponentTreeArticle,
  type ArticleComponentTreeNode,
  type FlatArticleComponentRow,
} from "./component-tree";

/**
 * Server Actions for a composite Article's bill-of-materials
 * (`article_components`, issue #92) — a sub-resource of one Article, scoped
 * to `parentArticleId` the same way `time_entries`/checklist items are scoped
 * to one Work Order (kept in its own file, same reasoning
 * `app/(app)/work-orders/time-entries-actions.ts`'s module comment gives).
 * Gated on the same `"articles"` RBAC module as `./actions.ts`/
 * `./groups-actions.ts` — a BOM line is configuration data for the article
 * database, not a separate RBAC row (matches `article_components`' RLS in
 * `supabase/migrations/20260829100000_articles_core.sql`: owner/administratie
 * write, any member reads — "if you can manage the article database, you can
 * manage its bill-of-materials").
 *
 * `parent_article_id` must be `is_composite = true` and no self-reference —
 * both entirely enforced by the DB's `validate_article_component` /
 * `article_components_no_self_reference`, not re-validated here.
 * `component_article_id` no longer has to be `is_composite = false` (issue
 * #124): a composite article may now itself be used as a component of
 * another composite article, at arbitrary nesting depth. In its place,
 * `validate_article_component` does real cycle detection — attaching a
 * component is rejected if it would make the parent article reachable from
 * that component's own descendant tree (see
 * `supabase/migrations/20260906090000_article_components_allow_nested_composites.sql`).
 * `mapArticleComponentDbError` below special-cases that rejection's exact
 * message into a clean one; every other DB rejection here still falls
 * through to the shared `mapDbError`'s `23514`/`23503` cases.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Same select shape as `ARTICLE_COMPONENT_SELECT` in `./actions.ts` — kept
 * as a separate literal rather than importing a non-exported const, same
 * "small enough to redeclare" precedent this module family already
 * establishes (see `./actions.ts`'s own comment on `ResolvedReferenceItem`). */
const ARTICLE_COMPONENT_SELECT =
  "*, component_article:articles!article_components_component_article_id_fkey(id,article_number,description,image_url,is_active,unit_item_id,article_unit:reference_list_items!articles_unit_item_id_fkey(value,label,color))";

/**
 * Lists a composite article's BOM lines. Any org member with `articles` read
 * access may call this (matches `./actions.ts`'s `getArticle`, which already
 * returns the same list embedded — this standalone action exists for a
 * component-editing panel that wants to refresh just the BOM lines without
 * re-fetching the whole article).
 */
export async function listArticleComponents(
  parentArticleId: string,
): Promise<ActionResult<{ components: ArticleComponentLineRecord[] }>> {
  const idResult = uuidSchema.safeParse(parentArticleId);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view this article's components.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_components")
    .select(ARTICLE_COMPONENT_SELECT)
    .eq("parent_article_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ components: (data ?? []) as ArticleComponentLineRecord[] });
}

/** Maps a DB error from an `article_components` write to a clean, user-safe
 * message. Adds two cases on top of the shared `mapDbError`, same "local
 * error mapping on top of the shared one" precedent `mapSiteDbError`/
 * `mapChecklistDbError` establish elsewhere in this codebase:
 *  - `23505` (unique_violation): `unique (parent_article_id,
 *    component_article_id)` means adding the same component twice to one
 *    BOM collides here.
 *  - The cycle rejection `validate_article_component` raises (issue #124,
 *    `20260906090000_article_components_allow_nested_composites.sql`) —
 *    Postgres gives every custom `raise exception` the same generic-looking
 *    `23514` check_violation code (same reasoning `mapDbError`'s own doc
 *    comment gives for why its `23514` case is one generic message covering
 *    several unrelated triggers), so the exact message text, not the code,
 *    is what's matched here. */
function mapArticleComponentDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "This article is already a component of this composite article. Edit its quantity instead of adding it again.";
  }
  if (
    error.code === "23514" &&
    error.message.includes(
      "article_components.component_article_id would create a cycle in the bill of materials",
    )
  ) {
    return "Adding this component would create a circular bill of materials (it — or something it's built from — already contains this article higher up the chain).";
  }
  return mapDbError(error);
}

/** Owner/administratie only (per the `articles` RBAC entry + RLS, both agree
 * — no gap to document here). `parent_article_id` is fixed to
 * `parentArticleId`; `component_article_id`/`quantity` come from `input`. */
export async function addArticleComponent(
  parentArticleId: string,
  input: unknown,
): Promise<ActionResult<{ component: ArticleComponentLineRecord }>> {
  const idResult = uuidSchema.safeParse(parentArticleId);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "create")) {
    return fail("Only the organization owner or administratie can add components.");
  }

  const parsed = articleComponentAddSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_components")
    .insert({
      parent_article_id: idResult.data,
      component_article_id: parsed.data.componentArticleId,
      quantity: parsed.data.quantity,
    })
    .select(ARTICLE_COMPONENT_SELECT)
    .single();

  if (error) return fail(mapArticleComponentDbError(error));
  return ok({ component: data as ArticleComponentLineRecord });
}

/**
 * Quantity is the only mutable field — `parent_article_id`/
 * `component_article_id` are insert-only (excluded from the DB's UPDATE
 * column grant, see the migration's grant comments); to change either side,
 * delete this row (`removeArticleComponent`) and `addArticleComponent` again.
 */
export async function updateArticleComponent(
  id: string,
  input: unknown,
): Promise<ActionResult<{ component: ArticleComponentLineRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid component id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "update")) {
    return fail("Only the organization owner or administratie can update components.");
  }

  const parsed = articleComponentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_components")
    .update({ quantity: parsed.data.quantity })
    .eq("id", idResult.data)
    .select(ARTICLE_COMPONENT_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Component not found, or you do not have permission to update it.");
  return ok({ component: data as ArticleComponentLineRecord });
}

/** Owner/administratie only (per the `articles` RBAC entry + RLS DELETE
 * policy, both agree — no gap to document here). */
export async function removeArticleComponent(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid component id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "delete")) {
    return fail("Only the organization owner or administratie can remove components.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_components")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Component not found, or you do not have permission to remove it.");
  return ok({ deletedId: data.id as string });
}

/** Basic display fields for one article inside a component tree — same
 * field set `ArticleComponentTreeArticle` (`./component-tree.ts`) expects,
 * shared by the root article fetch and every descendant's `component_article`
 * embed below so both share one shape. */
const ARTICLE_COMPONENT_TREE_ARTICLE_SELECT =
  "id,article_number,description,image_url,is_active,is_composite,unit_item_id,article_unit:reference_list_items!articles_unit_item_id_fkey(value,label,color)";

/**
 * Full multi-level bill-of-materials tree rooted at `articleId` (issue #124)
 * — this article's direct components, each of THEIR components, and so on,
 * arbitrarily deep, now that nested composites are allowed (see this file's
 * header comment and
 * `supabase/migrations/20260906090000_article_components_allow_nested_composites.sql`).
 * Downward only: a component article can belong to many different parent
 * composites simultaneously in this design, so there's no single
 * well-defined "root" upward the way Assets' physical-instance model has
 * (that direction is a separate follow-up, out of scope here).
 *
 * Fetches the org's ENTIRE `article_components` table once (RLS already
 * scopes it to the caller's own org — no `.eq("parent_article_id", ...)`
 * filter here on purpose) plus `articleId`'s own display fields, then hands
 * both to `buildArticleComponentTree` (`./component-tree.ts`) to assemble
 * the actual tree in plain TypeScript — same "one flat fetch, build the
 * tree in TS" precedent `./group-tree.ts` establishes for `article_groups`.
 * Any org member with `articles` read access may call this, same gate
 * `listArticleComponents`/`getArticle` already use.
 */
export async function getArticleComponentTree(
  articleId: string,
): Promise<ActionResult<{ tree: ArticleComponentTreeNode }>> {
  const idResult = uuidSchema.safeParse(articleId);
  if (!idResult.success) return fail("Invalid article id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view this article's components.");
  }

  const supabase = await createSupabaseServerClient();
  const [rootResult, rowsResult] = await Promise.all([
    supabase
      .from("articles")
      .select(ARTICLE_COMPONENT_TREE_ARTICLE_SELECT)
      .eq("id", idResult.data)
      .maybeSingle(),
    supabase
      .from("article_components")
      .select(
        `id, parent_article_id, component_article_id, quantity, component_article:articles!article_components_component_article_id_fkey(${ARTICLE_COMPONENT_TREE_ARTICLE_SELECT})`,
      ),
  ]);

  if (rootResult.error) return fail(mapDbError(rootResult.error));
  if (!rootResult.data) {
    return fail("Article not found, or you do not have permission to view it.");
  }
  if (rowsResult.error) return fail(mapDbError(rowsResult.error));

  const tree = buildArticleComponentTree(
    rootResult.data as unknown as ArticleComponentTreeArticle,
    (rowsResult.data ?? []) as unknown as FlatArticleComponentRow[],
  );

  return ok({ tree });
}
