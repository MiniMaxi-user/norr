"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { articleGroupCreateSchema, articleGroupUpdateSchema } from "./schema";

/**
 * Server Actions for the Article Group tree (issue #92) — a sub-resource of
 * the Articles module, same relationship `time_entries`/`checklists` have to
 * Work Orders (kept in its own file, same reasoning
 * `app/(app)/work-orders/time-entries-actions.ts`'s module comment gives).
 * Gated on the same `"articles"` RBAC module as `./actions.ts` — groups
 * aren't a separate row in the RBAC matrix, they're configuration data for
 * the article database (matches `article_groups`' RLS in
 * `supabase/migrations/20260829100000_articles_core.sql`: owner/administratie
 * write, any member reads).
 */

export interface ArticleGroupRecord {
  id: string;
  organization_id: string;
  parent_group_id: string | null;
  name: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleGroupDependencyCounts {
  /** Other `article_groups` rows whose `parent_group_id` is this group —
   * blocked at the DB level too (`parent_group_id` has no `on delete
   * cascade`/`set null`, default `NO ACTION`), surfaced here as a clean
   * pre-check the same way `getClientDependencyCounts` is. */
  childGroups: number;
  /** `articles` rows whose `group_id` is this group — same no-cascade DB
   * shape as `childGroups` above. */
  articles: number;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toArticleGroupInsertRow(
  input: ReturnType<typeof articleGroupCreateSchema.parse>,
  organizationId: string,
) {
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    name: input.name,
    parent_group_id: input.parentGroupId ?? null,
  };
  // sort_order omitted (not even sent as 0) when not provided — the DB's own
  // `not null default 0` covers that case, same "let the DB default apply"
  // treatment `toClientInsertRow`'s `status` omission documents in
  // `app/(app)/clients/actions.ts`.
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

function toArticleGroupUpdateRow(input: ReturnType<typeof articleGroupUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.parentGroupId !== undefined) row.parent_group_id = input.parentGroupId ?? null;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

/**
 * Returns the org's entire Article Group tree as flat rows (each with its own
 * `parent_group_id`) — the frontend builds the Group > Subgroup >
 * Subsubgroup tree UI from that, same "flat rows, client builds the tree"
 * treatment dependent reference-list items already get elsewhere
 * (`parent_item_id`). Any org member can call this (needed to populate a
 * "select group" `<select>`/tree-picker on the article form).
 */
export async function listArticleGroups(): Promise<ActionResult<{ groups: ArticleGroupRecord[] }>> {
  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view article groups.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_groups")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ groups: (data ?? []) as ArticleGroupRecord[] });
}

/** Owner/administratie only (per the `articles` RBAC entry + RLS, both agree
 * — no gap to document here). Cross-org parent / self-reference / cycle
 * checks are all enforced by the DB's `validate_article_group_parent`
 * trigger, surfaced via `mapDbError`'s existing `23514` case. */
export async function createArticleGroup(input: unknown): Promise<ActionResult<{ group: ArticleGroupRecord }>> {
  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "create")) {
    return fail("Only the organization owner or administratie can create article groups.");
  }

  const parsed = articleGroupCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_groups")
    .insert(toArticleGroupInsertRow(parsed.data, ctx.context.organizationId))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ group: data as ArticleGroupRecord });
}

/** Same gate/error-mapping as `createArticleGroup` above. */
export async function updateArticleGroup(
  id: string,
  input: unknown,
): Promise<ActionResult<{ group: ArticleGroupRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid group id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "update")) {
    return fail("Only the organization owner or administratie can update article groups.");
  }

  const parsed = articleGroupUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toArticleGroupUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("article_groups")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Article group not found, or you do not have permission to update it.");
  return ok({ group: data as ArticleGroupRecord });
}

/** Dependency counts for the delete-confirmation UI, same
 * `getClientDependencyCounts` convention in `app/(app)/clients/actions.ts`. */
export async function getArticleGroupDependencyCounts(
  id: string,
): Promise<ActionResult<ArticleGroupDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid group id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "read")) {
    return fail("You do not have permission to view this article group.");
  }

  const supabase = await createSupabaseServerClient();
  const [childGroupsResult, articlesResult] = await Promise.all([
    supabase.from("article_groups").select("id", { count: "exact", head: true }).eq("parent_group_id", idResult.data),
    supabase.from("articles").select("id", { count: "exact", head: true }).eq("group_id", idResult.data),
  ]);

  if (childGroupsResult.error) return fail(mapDbError(childGroupsResult.error));
  if (articlesResult.error) return fail(mapDbError(articlesResult.error));

  return ok({
    childGroups: childGroupsResult.count ?? 0,
    articles: articlesResult.count ?? 0,
  });
}

/**
 * Hard delete. Refuses when this group still has child groups or assigned
 * articles — same "app-layer refuses rather than lets the DB block it with a
 * raw error" style `deleteArticle` uses in `./actions.ts` (and here, the DB
 * genuinely WOULD block it regardless: `article_groups.parent_group_id` /
 * `articles.group_id` both have no `on delete cascade`/`set null`, so a
 * dependent row triggers a `23503` — this pre-check just gives a cleaner,
 * specific message before that raw rejection is ever reached).
 */
export async function deleteArticleGroup(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid group id.");

  const ctx = await requireModuleContext("articles");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "articles", "delete")) {
    return fail("Only the organization owner or administratie can delete article groups.");
  }

  const supabase = await createSupabaseServerClient();
  const [childGroupsResult, articlesResult] = await Promise.all([
    supabase.from("article_groups").select("id", { count: "exact", head: true }).eq("parent_group_id", idResult.data),
    supabase.from("articles").select("id", { count: "exact", head: true }).eq("group_id", idResult.data),
  ]);
  if (childGroupsResult.error) return fail(mapDbError(childGroupsResult.error));
  if (articlesResult.error) return fail(mapDbError(articlesResult.error));

  const childGroups = childGroupsResult.count ?? 0;
  const articles = articlesResult.count ?? 0;
  if (childGroups > 0) {
    return fail(
      `This group has ${childGroups} subgroup${childGroups === 1 ? "" : "s"}. Move or delete ${childGroups === 1 ? "it" : "them"} first.`,
    );
  }
  if (articles > 0) {
    return fail(
      `This group has ${articles} article${articles === 1 ? "" : "s"} assigned to it. Reassign ${articles === 1 ? "it" : "them"} first.`,
    );
  }

  const { data, error } = await supabase
    .from("article_groups")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Article group not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
