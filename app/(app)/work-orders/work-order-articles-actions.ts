"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { workOrderArticleCreateSchema, workOrderArticleUpdateSchema } from "./schema";

/**
 * Server Actions for a Work Order's consumed Articles (issue #94 schema
 * prerequisite, second stage) — a sub-resource of Work Orders, same
 * relationship `time_entries` has to `work_orders`
 * (`./time-entries-actions.ts`). Kept in its own file rather than folded
 * into `actions.ts`/`time-entries-actions.ts`, same reasoning those files'
 * own headers give for their own split.
 *
 * Reuses the `planning` RBAC module — no new module/matrix row, see
 * `supabase/migrations/20260830100000_work_order_articles_and_quote_traceability.sql`'s
 * design note 4. The matrix row (unchanged from Time Entries):
 *   owner/planner:          CRUD, all rows
 *   engineer:                read_own / update_own / create_own, own rows
 *                            only (`created_by = auth.uid()`); NO delete
 *   finance/administratie:  read, all rows
 *
 * Unlike `time_entries.user_id` (who the time belongs to, settable by an
 * owner/planner logging on someone else's behalf), `work_order_articles` has
 * no such column at all — `created_by` is ALWAYS trigger-stamped to the
 * caller (`set_created_by`), never a field this module writes or exposes as
 * settable. There is therefore no "log for others" concept to replicate from
 * `clockIn`/`createTimeEntry` here: every caller, regardless of role, always
 * creates a row attributed to themselves; an owner/planner's extra `CRUD`
 * privilege is about being able to read/update/delete ANY row (not just
 * their own), not about attributing a row to someone else.
 */

export interface WorkOrderArticleRecord {
  id: string;
  organization_id: string;
  work_order_id: string;
  article_id: string;
  quantity: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `articles!work_order_articles_article_id_fkey(...)` — see
   * `WORK_ORDER_ARTICLE_SELECT` below. Postgres's default unnamed-FK naming
   * (`<table>_<column>_fkey`), same confirmed convention `ARTICLE_SELECT`/
   * `TIME_ENTRY_SELECT` already rely on elsewhere in this codebase. Should
   * never actually be `null` in practice (`article_id` is `not null` and has
   * no `on delete cascade`/`set null` gap), but modeled as nullable
   * defensively like every other embed in this codebase. */
  article: {
    id: string;
    article_number: string;
    description: string;
    sale_price: number | null;
    purchase_price: number | null;
  } | null;
}

/** Shared select shape for every query returning a `WorkOrderArticleRecord`
 * — resolves the consumed article's own display fields + live prices in the
 * same round trip, same reasoning as `TIME_ENTRY_SELECT`/`ARTICLE_SELECT`. */
const WORK_ORDER_ARTICLE_SELECT =
  "*, article:articles!work_order_articles_article_id_fkey(id, article_number, description, sale_price, purchase_price)";

const uuidSchema = z.string().uuid("Invalid id.");

function toWorkOrderArticleUpdateRow(input: ReturnType<typeof workOrderArticleUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.articleId !== undefined) row.article_id = input.articleId;
  if (input.quantity !== undefined) row.quantity = input.quantity;
  return row;
}

/**
 * Lists a work order's consumed articles, most-recently-logged first. Gated
 * on `canAny(actor, "planning", ["read", "read_own"])`; for an engineer
 * (`read_own` only) this does NOT add an app-layer `created_by` filter — RLS
 * (`work_order_articles_select_scoped`) already scopes the result to their
 * own rows, same lesson `listTimeEntries` documents in `./time-entries-actions.ts`.
 */
export async function listWorkOrderArticles(
  workOrderId: string,
): Promise<ActionResult<{ workOrderArticles: WorkOrderArticleRecord[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view consumed articles.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_articles")
    .select(WORK_ORDER_ARTICLE_SELECT)
    .eq("work_order_id", idResult.data)
    .order("created_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  return ok({ workOrderArticles: (data ?? []) as WorkOrderArticleRecord[] });
}

/**
 * Logs a consumed article against `workOrderId`. Gated on
 * `canAny(actor, "planning", ["create", "create_own"])` — same module-level
 * gate as `createTimeEntry`, but (per the module comment above) there is no
 * `userId`/on-behalf-of branch to resolve here: `created_by` is always the
 * caller, trigger-stamped, never sent from this action's own insert row.
 */
export async function createWorkOrderArticle(
  workOrderId: string,
  input: unknown,
): Promise<ActionResult<{ workOrderArticle: WorkOrderArticleRecord }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["create", "create_own"])) {
    return fail("You do not have permission to log consumed articles.");
  }

  const parsed = workOrderArticleCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_articles")
    .insert({
      work_order_id: idResult.data,
      article_id: parsed.data.articleId,
      quantity: parsed.data.quantity,
    })
    .select(WORK_ORDER_ARTICLE_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ workOrderArticle: data as WorkOrderArticleRecord });
}

/**
 * Corrects an existing consumed-article row (which article, or how much).
 * `workOrderId` is not updatable here (immutable after creation — delete +
 * re-add to move it to a different work order, same convention
 * `quoteLineItemUpdateSchema`/`articleComponentUpdateSchema` already
 * establish). Gated on `canAny(actor, "planning", ["update", "update_own"])`;
 * an engineer can only correct their own row — RLS
 * (`work_order_articles_update_scoped`) enforces this independently of the
 * app-layer gate, same split `updateTimeEntry` documents.
 */
export async function updateWorkOrderArticle(
  id: string,
  input: unknown,
): Promise<ActionResult<{ workOrderArticle: WorkOrderArticleRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order article id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to update consumed articles.");
  }

  const parsed = workOrderArticleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toWorkOrderArticleUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_articles")
    .update(row)
    .eq("id", idResult.data)
    .select(WORK_ORDER_ARTICLE_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Consumed article not found, or you do not have permission to update it.");
  return ok({ workOrderArticle: data as WorkOrderArticleRecord });
}

/** Owner/planner only (per the RBAC matrix + RLS DELETE policy, both agree —
 * engineer has no `delete` action on `planning` at all, same "no gap to
 * document" shape `deleteTimeEntry` documents in `./time-entries-actions.ts`). */
export async function deleteWorkOrderArticle(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order article id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "planning", "delete")) {
    return fail("Only an owner or planner can delete consumed articles.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_articles")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Consumed article not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
