"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { readThroughReferenceDataCache, invalidateReferenceDataCache } from "@/lib/cache/reference-data";
import { solutionSubtypeCreateSchema, solutionSubtypeUpdateSchema } from "./schema";

/**
 * Server Actions for the Solution Subtype tree (issues #134/#138) —
 * structurally identical to `./subtypes-actions.ts` (Activity Subtypes) minus
 * every `type_id`/root-type concept: `solution_subtypes` is never linked to
 * Type at any level.
 *
 * Same RBAC/module-context gating decision as `./subtypes-actions.ts` — see
 * that file's module comment for the full reasoning: `solution_subtypes`' RLS
 * is also SELECT any org member, INSERT/UPDATE/DELETE OWNER ONLY, and the
 * migration's own design note 5 groups both new tables into the same
 * "Settings-configured tenant taxonomy" category as `reference_list_items`,
 * gated via the `"settings"` RBAC module end-to-end (not `"activities"`,
 * whose `planner` row is broader than this table's RLS boundary and would
 * open a can()-vs-RLS gap).
 */

export interface SolutionSubtypeRecord {
  id: string;
  organization_id: string;
  parent_subtype_id: string | null;
  name: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SolutionSubtypeDependencyCounts {
  /** Other `solution_subtypes` rows whose `parent_subtype_id` is this
   * subtype — blocked at the DB level too (no `on delete cascade`/`set
   * null`), surfaced here as a clean pre-check, same as
   * `ActivitySubtypeDependencyCounts.childSubtypes`. */
  childSubtypes: number;
  /** `activities` rows whose `solution_subtype_id` is this subtype — same
   * no-cascade DB shape as `childSubtypes` above. */
  activities: number;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toSolutionSubtypeInsertRow(
  input: ReturnType<typeof solutionSubtypeCreateSchema.parse>,
  organizationId: string,
) {
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    name: input.name,
    parent_subtype_id: input.parentSubtypeId ?? null,
  };
  // sort_order omitted (not even sent as 0) when not provided — the DB's own
  // `not null default 0` covers that case, same treatment
  // `toArticleGroupInsertRow`'s `sort_order` omission documents.
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

function toSolutionSubtypeUpdateRow(input: ReturnType<typeof solutionSubtypeUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.parentSubtypeId !== undefined) row.parent_subtype_id = input.parentSubtypeId ?? null;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

/**
 * Returns the org's entire Solution Subtype tree as flat rows (each with its
 * own `parent_subtype_id`) — the frontend builds both the Settings tree
 * manager AND the Activity page's cascading picker from these same flat rows
 * via `app/(app)/activities/solution-subtype-tree.ts`'s helpers. Any org
 * member can call this (matches `solution_subtypes_select_member`'s "any org
 * member" RLS boundary).
 */
export async function listSolutionSubtypes(): Promise<ActionResult<{ subtypes: SolutionSubtypeRecord[] }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view solution subtypes.");
  }

  const supabase = await createSupabaseServerClient();

  // Cached (issue #147) — keyed by org + `solution_subtypes` (one whole tree
  // per org, no further subdivision).
  try {
    const subtypes = await readThroughReferenceDataCache(
      ctx.context.organizationId,
      "solution_subtypes",
      async () => {
        // Explicit column projection (issue #149) — every tree consumer
        // (`solution-subtype-tree.ts`'s helpers, the Settings tree manager,
        // the Activity page's cascading picker) only ever reads `id`/
        // `parent_subtype_id`/`name`/`sort_order`; `organization_id`/
        // `created_by`/`created_at`/`updated_at` are never read back from
        // this list.
        const { data, error } = await supabase
          .from("solution_subtypes")
          .select("id, parent_subtype_id, name, sort_order")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });

        // Thrown (not `fail(...)`-returned) — see
        // `lib/cache/reference-data.ts`'s module comment: a thrown fetcher
        // is never cached, so a transient DB error is never "stuck" cached.
        if (error) throw new Error(mapDbError(error));
        return (data ?? []) as SolutionSubtypeRecord[];
      },
    );
    return ok({ subtypes });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Something went wrong loading solution subtypes.");
  }
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). Cross-org
 * parent / self-reference / cycle checks are all enforced by the DB's
 * `validate_solution_subtype_parent` trigger. */
export async function createSolutionSubtype(
  input: unknown,
): Promise<ActionResult<{ subtype: SolutionSubtypeRecord }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can create solution subtypes.");
  }

  const parsed = solutionSubtypeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("solution_subtypes")
    .insert(toSolutionSubtypeInsertRow(parsed.data, ctx.context.organizationId))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  invalidateReferenceDataCache(ctx.context.organizationId, "solution_subtypes");
  return ok({ subtype: data as SolutionSubtypeRecord });
}

/** Same gate/error-mapping as `createSolutionSubtype` above. */
export async function updateSolutionSubtype(
  id: string,
  input: unknown,
): Promise<ActionResult<{ subtype: SolutionSubtypeRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can update solution subtypes.");
  }

  const parsed = solutionSubtypeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toSolutionSubtypeUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("solution_subtypes")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Solution subtype not found, or you do not have permission to update it.");
  invalidateReferenceDataCache(ctx.context.organizationId, "solution_subtypes");
  return ok({ subtype: data as SolutionSubtypeRecord });
}

/** Dependency counts for the delete-confirmation UI, same
 * `getActivitySubtypeDependencyCounts` convention. */
export async function getSolutionSubtypeDependencyCounts(
  id: string,
): Promise<ActionResult<SolutionSubtypeDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view this solution subtype.");
  }

  const supabase = await createSupabaseServerClient();
  const [childSubtypesResult, activitiesResult] = await Promise.all([
    supabase
      .from("solution_subtypes")
      .select("id", { count: "exact", head: true })
      .eq("parent_subtype_id", idResult.data),
    supabase.from("activities").select("id", { count: "exact", head: true }).eq("solution_subtype_id", idResult.data),
  ]);

  if (childSubtypesResult.error) return fail(mapDbError(childSubtypesResult.error));
  if (activitiesResult.error) return fail(mapDbError(activitiesResult.error));

  return ok({
    childSubtypes: childSubtypesResult.count ?? 0,
    activities: activitiesResult.count ?? 0,
  });
}

/**
 * Hard delete. Refuses when this subtype still has child subtypes or
 * assigned activities — same pre-check-then-delete shape as
 * `deleteActivitySubtype` (and here too, the DB genuinely WOULD block it
 * regardless: neither `solution_subtypes.parent_subtype_id` nor
 * `activities.solution_subtype_id` has an `on delete cascade`/`set null`).
 */
export async function deleteSolutionSubtype(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete solution subtypes.");
  }

  const supabase = await createSupabaseServerClient();
  const [childSubtypesResult, activitiesResult] = await Promise.all([
    supabase
      .from("solution_subtypes")
      .select("id", { count: "exact", head: true })
      .eq("parent_subtype_id", idResult.data),
    supabase.from("activities").select("id", { count: "exact", head: true }).eq("solution_subtype_id", idResult.data),
  ]);
  if (childSubtypesResult.error) return fail(mapDbError(childSubtypesResult.error));
  if (activitiesResult.error) return fail(mapDbError(activitiesResult.error));

  const childSubtypes = childSubtypesResult.count ?? 0;
  const activities = activitiesResult.count ?? 0;
  if (childSubtypes > 0) {
    return fail(
      `This subtype has ${childSubtypes} child subtype${childSubtypes === 1 ? "" : "s"}. Move or delete ${childSubtypes === 1 ? "it" : "them"} first.`,
    );
  }
  if (activities > 0) {
    return fail(
      `This subtype is assigned to ${activities} activit${activities === 1 ? "y" : "ies"}. Reassign ${activities === 1 ? "it" : "them"} first.`,
    );
  }

  const { data, error } = await supabase
    .from("solution_subtypes")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Solution subtype not found, or you do not have permission to delete it.");
  invalidateReferenceDataCache(ctx.context.organizationId, "solution_subtypes");
  return ok({ deletedId: data.id as string });
}
