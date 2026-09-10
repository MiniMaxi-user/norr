"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { activitySubtypeCreateSchema, activitySubtypeUpdateSchema } from "./schema";

/**
 * Server Actions for the Activity Subtype tree (issues #134/#138) — a
 * sub-resource of the Activities module, same "kept in its own file" reasoning
 * `app/(app)/articles/groups-actions.ts`'s own module comment gives for
 * Article Groups under Articles.
 *
 * RBAC/module-context gating — deliberately `"settings"`, NOT `"activities"`:
 * `activity_subtypes`' RLS (`supabase/migrations/
 * 20260912090000_activity_and_solution_subtypes.sql`) is SELECT any org
 * member, INSERT/UPDATE/DELETE OWNER ONLY. The `activities` RBAC module
 * (`lib/rbac/permissions.ts`) grants `planner` full CRUD too — relying on
 * `can(actor, "activities", "create"/"update"/"delete")` here would open a
 * real can()-vs-RLS gap (a planner would pass the app-layer check and only
 * then get rejected by RLS with a raw `42501`). The migration's own design
 * note 5 resolves this explicitly: Activity Subtype/Solution type are
 * "Settings-configured tenant taxonomies, the same category as the
 * reference-lists/Volume list... gated owner-only via the `settings` RBAC
 * module", the same boundary `lib/reference-lists/actions.ts` already uses
 * end-to-end (read included, not just writes) for `reference_list_items` —
 * this file mirrors that exactly rather than mixing `"activities"` (read)
 * with `"settings"` (write). `settings`' own matrix (owner CRUD, every other
 * tenant role plain `read`) matches this table's RLS boundary exactly for
 * every action, so there is no can()-vs-RLS gap to document for any function
 * below — same as `lib/reference-lists/actions.ts`'s own module comment
 * concludes for itself. `requireModuleContext("settings")` is used (not
 * `"activities"`) for the same reason: `hasFeature` gating should match the
 * RBAC module actually being checked.
 */

export interface ActivitySubtypeRecord {
  id: string;
  organization_id: string;
  parent_subtype_id: string | null;
  /** Non-null only on a root node (`parent_subtype_id is null`) — see the
   * migration's `activity_subtypes_root_xor_parent` CHECK. */
  type_id: string | null;
  name: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivitySubtypeDependencyCounts {
  /** Other `activity_subtypes` rows whose `parent_subtype_id` is this
   * subtype — blocked at the DB level too (`parent_subtype_id` has no `on
   * delete cascade`/`set null`, default `NO ACTION`), surfaced here as a
   * clean pre-check the same way `getArticleGroupDependencyCounts` is. */
  childSubtypes: number;
  /** `activities` rows whose `activity_subtype_id` is this subtype — same
   * no-cascade DB shape as `childSubtypes` above. */
  activities: number;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toActivitySubtypeInsertRow(
  input: ReturnType<typeof activitySubtypeCreateSchema.parse>,
  organizationId: string,
) {
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    name: input.name,
    // Always included (not conditionally) — activitySubtypeCreateSchema's
    // superRefine already guarantees exactly one of the two is present, and
    // the DB's activity_subtypes_root_xor_parent CHECK is the real backstop
    // either way, so there is no ambiguity from sending the other as null.
    parent_subtype_id: input.parentSubtypeId ?? null,
    type_id: input.typeId ?? null,
  };
  // sort_order omitted (not even sent as 0) when not provided — the DB's own
  // `not null default 0` covers that case, same treatment
  // `toArticleGroupInsertRow`'s `sort_order` omission documents.
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

function toActivitySubtypeUpdateRow(input: ReturnType<typeof activitySubtypeUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.parentSubtypeId !== undefined) row.parent_subtype_id = input.parentSubtypeId ?? null;
  if (input.typeId !== undefined) row.type_id = input.typeId ?? null;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

/**
 * Returns the org's entire Activity Subtype tree as flat rows (each with its
 * own `parent_subtype_id`/`type_id`) — the frontend builds both the Settings
 * tree manager AND the Activity page's 3-level cascading picker from these
 * same flat rows via `app/(app)/activities/subtype-tree.ts`'s helpers. Any
 * org member can call this (matches `activity_subtypes_select_member`'s "any
 * org member" RLS boundary — see the module comment above for why this is
 * gated on `"settings"`, not `"activities"`).
 */
export async function listActivitySubtypes(): Promise<ActionResult<{ subtypes: ActivitySubtypeRecord[] }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view activity subtypes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_subtypes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ subtypes: (data ?? []) as ActivitySubtypeRecord[] });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree — see the
 * module comment above). Cross-org parent / self-reference / cycle / root
 * type-link checks are all enforced by the DB's
 * `validate_activity_subtype_parent` trigger, surfaced via `mapDbError`'s
 * existing `23503`/`23514` cases. */
export async function createActivitySubtype(
  input: unknown,
): Promise<ActionResult<{ subtype: ActivitySubtypeRecord }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can create activity subtypes.");
  }

  const parsed = activitySubtypeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_subtypes")
    .insert(toActivitySubtypeInsertRow(parsed.data, ctx.context.organizationId))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ subtype: data as ActivitySubtypeRecord });
}

/** Same gate/error-mapping as `createActivitySubtype` above. */
export async function updateActivitySubtype(
  id: string,
  input: unknown,
): Promise<ActionResult<{ subtype: ActivitySubtypeRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can update activity subtypes.");
  }

  const parsed = activitySubtypeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toActivitySubtypeUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_subtypes")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Activity subtype not found, or you do not have permission to update it.");
  return ok({ subtype: data as ActivitySubtypeRecord });
}

/** Dependency counts for the delete-confirmation UI, same
 * `getArticleGroupDependencyCounts` convention. */
export async function getActivitySubtypeDependencyCounts(
  id: string,
): Promise<ActionResult<ActivitySubtypeDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view this activity subtype.");
  }

  const supabase = await createSupabaseServerClient();
  const [childSubtypesResult, activitiesResult] = await Promise.all([
    supabase
      .from("activity_subtypes")
      .select("id", { count: "exact", head: true })
      .eq("parent_subtype_id", idResult.data),
    supabase.from("activities").select("id", { count: "exact", head: true }).eq("activity_subtype_id", idResult.data),
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
 * assigned activities — same "app-layer refuses rather than lets the DB
 * block it with a raw error" style `deleteArticleGroup` uses (and here too,
 * the DB genuinely WOULD block it regardless: neither
 * `activity_subtypes.parent_subtype_id` nor `activities.activity_subtype_id`
 * has an `on delete cascade`/`set null`, so a dependent row triggers a
 * `23503` — this pre-check just gives a cleaner, specific message first).
 */
export async function deleteActivitySubtype(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid subtype id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete activity subtypes.");
  }

  const supabase = await createSupabaseServerClient();
  const [childSubtypesResult, activitiesResult] = await Promise.all([
    supabase
      .from("activity_subtypes")
      .select("id", { count: "exact", head: true })
      .eq("parent_subtype_id", idResult.data),
    supabase.from("activities").select("id", { count: "exact", head: true }).eq("activity_subtype_id", idResult.data),
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
    .from("activity_subtypes")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Activity subtype not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
