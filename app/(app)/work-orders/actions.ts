"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { workOrderCreateSchema, workOrderUpdateSchema } from "./schema";

/**
 * Server Actions for the Work Orders module (issue #13 backend half, second
 * stage) — the first-class job/ticket entity, a new top-level module (same
 * tier as Clients/Assets, not a sub-feature of either). Same four-step
 * preamble as every other module's actions (see the block comment at the top
 * of `app/(app)/clients/actions.ts`): resolve module context (`hasFeature` +
 * RBAC actor) -> `can()`/`canAny()` -> Zod validation -> query under the
 * caller's own session (RLS is always the real backstop).
 *
 * RBAC recap for `planning` (lib/rbac/permissions.ts, matches
 * docs/ARCHITECTURE.md matrix): `owner`/`planner` have CRUD; `engineer` has
 * only `read_own`/`update_own` (their assigned rows, no create/delete);
 * `finance`/`administratie` have plain `read` (all rows).
 *
 * *** Unlike `clients`/`assets`, this is the first module where RLS enforces
 * the same role split for real, not just the application layer. ***
 * `supabase/migrations/20260823120000_work_orders_core.sql` implements the
 * `planning` matrix row directly in Postgres via `current_member_role`:
 *  - SELECT: any member, except an engineer, who only sees rows where
 *    `assigned_to = auth.uid()`.
 *  - INSERT: owner/planner only.
 *  - UPDATE: owner/planner any row; engineer only their own assigned row
 *    (`USING`), and cannot reassign a work order away from themselves
 *    (`WITH CHECK` re-requires `assigned_to = auth.uid()` on the new row —
 *    an engineer's attempt to set `assignedTo` to someone else fails as a
 *    `42501`, which `mapDbError` already turns into a clean message, same as
 *    the Planner-asset-update gap documented in `app/(app)/assets/actions.ts`,
 *    except here it's the *intended* behavior, not a gap).
 *  - DELETE: owner/planner only.
 *
 * Practical consequence for callers of `listWorkOrders`/`getWorkOrder`: an
 * engineer's plain query already comes back scoped to their assigned rows —
 * these actions do NOT add an app-layer `assigned_to` filter on top (there
 * would be nothing left to filter; RLS already did it). `can()`/`canAny()`
 * here still matter independently: they gate which actions exist at all for
 * a role (e.g. correctly rejecting an engineer's `createWorkOrder`/
 * `deleteWorkOrder` attempt before ever hitting the DB) and drive UI
 * affordances — they are not redundant with RLS just because RLS also
 * happens to agree here.
 *
 * No app-layer pre-validation of `siteId`/`assetId`/`assignedTo`/`statusId`/
 * `priorityId` cross-field relationships (unlike `assets.subtypeId`'s
 * `validateAssetSubtype` shape check): `status_id`/`priority_id` are both
 * flat (non-dependent) reference lists here, and `site_id`/`asset_id`/
 * `assigned_to`'s parentage checks are left entirely to the
 * `validate_work_order_relations`/`validate_work_order_reference_items` DB
 * triggers (same trust boundary `createSite`'s `clientId` and
 * `createAsset`'s `siteId` already use — the DB's `23503`/`23514` is mapped
 * to a clean message by `mapDbError`, just not pre-empted with an extra
 * round trip).
 */

/** Resolved (embedded) shape of a `reference_list_items` row — mirrors
 * `ResolvedReferenceItem` in `app/(app)/assets/actions.ts`; kept as a local
 * copy rather than a shared import, same "each module owns its own" pattern
 * that file already establishes. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface WorkOrderRecord {
  id: string;
  organization_id: string;
  client_id: string;
  site_id: string | null;
  asset_id: string | null;
  contract_id: string | null;
  assigned_to: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  status_id: string;
  priority_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!work_orders_status_id_fkey(...)` —
   * see `WORK_ORDER_SELECT` below. Postgres's default FK naming for an
   * unnamed column FK is `<table>_<column>_fkey` (same reasoning
   * `app/(app)/assets/actions.ts`'s `ASSET_SELECT` comment documents for
   * `assets_type_id_fkey`/`assets_status_id_fkey`). */
  work_order_status: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!work_orders_priority_id_fkey(...)`.
   * `null` whenever `priority_id` is `null` (no priority set). */
  work_order_priority: ResolvedReferenceItem | null;
  /** Embedded via `contracts(id, name)` (issue #33) — a plain FK embed (not
   * `reference_list_items`, so no `!fkey` disambiguator is needed: `contract_id`
   * is the only FK from `work_orders` into `contracts`). `null` whenever
   * `contract_id` is `null` (no contract linked). */
  contract: { id: string; name: string } | null;
}

/** Shared select shape for every query returning a `WorkOrderRecord`, so the
 * frontend gets the resolved status/priority value/label/color, plus the
 * linked contract's name, in one round trip instead of N+1-ing a lookup per
 * row per column — same reasoning as `ASSET_SELECT` in
 * `app/(app)/assets/actions.ts`. */
const WORK_ORDER_SELECT =
  "*, work_order_status:reference_list_items!work_orders_status_id_fkey(value,label,color), work_order_priority:reference_list_items!work_orders_priority_id_fkey(value,label,color), contract:contracts(id, name)";

const uuidSchema = z.string().uuid("Invalid id.");

function toWorkOrderInsertRow(input: ReturnType<typeof workOrderCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    site_id: input.siteId ?? null,
    asset_id: input.assetId ?? null,
    contract_id: input.contractId ?? null,
    assigned_to: input.assignedTo ?? null,
    title: input.title,
    description: input.description ?? null,
    notes: input.notes ?? null,
    priority_id: input.priorityId ?? null,
    scheduled_at: input.scheduledAt ?? null,
    completed_at: input.completedAt ?? null,
  };
  // status_id is intentionally omitted (not even sent as null) when not
  // provided — the `derive_work_order_organization_id` DB trigger fills in
  // the organization's default `work_order_status` item on insert. Same
  // reasoning/comment as `toAssetInsertRow` in app/(app)/assets/actions.ts.
  if (input.statusId !== undefined) row.status_id = input.statusId;
  return row;
}

function toWorkOrderUpdateRow(input: ReturnType<typeof workOrderUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.siteId !== undefined) row.site_id = input.siteId ?? null;
  if (input.assetId !== undefined) row.asset_id = input.assetId ?? null;
  if (input.contractId !== undefined) row.contract_id = input.contractId ?? null;
  if (input.assignedTo !== undefined) row.assigned_to = input.assignedTo ?? null;
  if (input.title !== undefined) row.title = input.title;
  if (input.description !== undefined) row.description = input.description ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  if (input.statusId !== undefined) row.status_id = input.statusId;
  if (input.priorityId !== undefined) row.priority_id = input.priorityId ?? null;
  if (input.scheduledAt !== undefined) row.scheduled_at = input.scheduledAt ?? null;
  if (input.completedAt !== undefined) row.completed_at = input.completedAt ?? null;
  return row;
}

export interface ListWorkOrdersOptions {
  clientId?: string;
  siteId?: string;
  assetId?: string;
  statusId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lists work orders, org-scoped via RLS automatically (and, for an engineer
 * caller, already scoped to their assigned rows only — see the module
 * comment above). Supports filtering by `clientId`/`siteId`/`assetId`/
 * `statusId`/`assignedTo` (all optional, combinable) for the list/kanban/
 * calendar views per docs/ARCHITECTURE.md's Planning view switcher.
 *
 * Default order: soonest-scheduled first (nulls last), then most-recently
 * created — a reasonable default "what's next" queue order; the frontend's
 * list/kanban/calendar views are free to re-sort client-side for their own
 * presentation.
 */
export async function listWorkOrders(
  options: ListWorkOrdersOptions = {},
): Promise<ActionResult<{ workOrders: WorkOrderRecord[]; count: number }>> {
  for (const [label, value] of [
    ["client id filter", options.clientId],
    ["site id filter", options.siteId],
    ["asset id filter", options.assetId],
    ["status id filter", options.statusId],
    ["assignedTo filter", options.assignedTo],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) {
      return fail(`Invalid ${label}.`);
    }
  }

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view work orders.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("work_orders").select(WORK_ORDER_SELECT, { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.siteId) query = query.eq("site_id", options.siteId);
  if (options.assetId) query = query.eq("asset_id", options.assetId);
  if (options.statusId) query = query.eq("status_id", options.statusId);
  if (options.assignedTo) query = query.eq("assigned_to", options.assignedTo);
  query = query
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ workOrders: (data ?? []) as WorkOrderRecord[], count: count ?? 0 });
}

export async function getWorkOrder(id: string): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view this work order.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_orders")
    .select(WORK_ORDER_SELECT)
    .eq("id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Work order not found.");
  return ok({ workOrder: data as WorkOrderRecord });
}

/** Owner/planner only (per the RBAC matrix + RLS INSERT policy, both agree —
 * engineer has no `create` action in the matrix at all, so there is no gap
 * to document here the way there is for `assets.update`). */
export async function createWorkOrder(input: unknown): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "planning", "create")) {
    return fail("Only an owner or planner can create work orders.");
  }

  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_orders")
    .insert(toWorkOrderInsertRow(parsed.data))
    .select(WORK_ORDER_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ workOrder: data as WorkOrderRecord });
}

/**
 * Owner/planner: any row. Engineer: only their own assigned row, and cannot
 * reassign it away from themselves — see the module comment above for why
 * that surfaces as a clean `mapDbError` message (`42501`) rather than a
 * silent no-op the way the Planner-asset-update RLS gap does.
 */
export async function updateWorkOrder(
  id: string,
  input: unknown,
): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to update work orders.");
  }

  const parsed = workOrderUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toWorkOrderUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_orders")
    .update(row)
    .eq("id", idResult.data)
    .select(WORK_ORDER_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Work order not found, or you do not have permission to update it.");
  return ok({ workOrder: data as WorkOrderRecord });
}

/** Owner/planner only (per the RBAC matrix + RLS DELETE policy, both agree —
 * engineer has no `delete` action in the matrix at all). */
export async function deleteWorkOrder(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "planning", "delete")) {
    return fail("Only an owner or planner can delete work orders.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_orders")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Work order not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
