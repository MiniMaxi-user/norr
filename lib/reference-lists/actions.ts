"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { listKeySchema, referenceItemCreateSchema, referenceItemUpdateSchema } from "./schema";

/**
 * Extended (issue #26) for the generic dependent-reference-list mechanism
 * (`reference_lists.parent_list_key` / `reference_list_items.parent_item_id`,
 * `supabase/migrations/20260823090000_contacts_dependent_reference_lists.sql`):
 *  - `listReferenceItems` accepts an optional `parentItemId` filter (for the
 *    cascading-select UX — "show me this list's items whose `parent_item_id`
 *    equals this selected parent item") and returns the list's own
 *    `parent_list_key` alongside its items, so the frontend knows whether
 *    (and against which list) it needs to enforce that cascade at all.
 *  - `createReferenceItem`/`updateReferenceItem` validate `parentItemId`
 *    themselves (via `validateDependentParentItem` below) before touching
 *    the DB — required and must resolve to an item from the configured
 *    parent list when the list is dependent; must be absent when it isn't —
 *    the same rule `validate_reference_list_item_parent` enforces at the DB
 *    layer, duplicated here purely so a bad value comes back as a clean
 *    field error instead of a raw/generic mapped Postgres error.
 */

/**
 * Server Actions for tenant-configurable reference lists ("picklists") —
 * generalizes Asset Type / Asset Status (and every future tenant-
 * configurable dropdown, e.g. Phase 2 Contract Type) per
 * docs/ARCHITECTURE.md "Tenant-configurable reference data" and
 * `supabase/migrations/20260822200000_reference_lists.sql`.
 *
 * Deliberately NOT under `app/(app)/assets/` — every module that gains a
 * `reference_list_items`-backed column reuses this exact mechanism, keyed
 * by `list_key` (today: `asset_type`, `asset_status`).
 *
 * Same four-step preamble as every other module's actions (see the block
 * comment at the top of `app/(app)/clients/actions.ts`): resolve module
 * context (`hasFeature` + RBAC actor) -> `can()` -> Zod validation -> query
 * under the caller's own session (RLS is always the real backstop).
 *
 * RBAC: modeled as a new `"settings"` module in `lib/rbac/permissions.ts`
 * (owner: CRUD, every other tenant role: `read`) — see that file's comment
 * on the `settings` entry for why this was added unilaterally rather than
 * handed off. This mirrors the DB RLS boundary exactly (`reference_lists`/
 * `reference_list_items`: SELECT any member, INSERT/UPDATE/DELETE owner
 * only), so `can()` here and RLS agree — unlike `assets.update`, there is
 * no "allowed by `can()`, silently rejected by RLS" gap to document for any
 * action in this file.
 */

export interface ReferenceListItemRecord {
  id: string;
  reference_list_id: string;
  organization_id: string;
  value: string;
  label: string;
  color: string | null;
  sort_order: number;
  is_default: boolean;
  /** FK to the parent list's item this item belongs under — non-null exactly
   * when this item's own list has `parent_list_key` set (e.g. an
   * `asset_subtype` item's `parent_item_id` points at its `asset_type`
   * item). `null` for every item on a non-dependent (flat) list. */
  parent_item_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Resolves the caller's org's `reference_lists.id` for `listKey` (RLS scopes
 * the SELECT to the caller's own org automatically — no explicit
 * `organization_id` filter needed, same as every other tenant-scoped
 * query in this codebase).
 *
 * Every org should already have a `reference_lists` row for `asset_type`/
 * `asset_status` via `seed_default_reference_lists` (fired automatically on
 * organization creation — see the migration). `createIfMissing` is a
 * defensive fallback only: it lets an owner start configuring a brand new
 * `list_key` (e.g. Phase 2's `contract_type`, before that feature's own
 * migration has extended the seed function and backfilled existing orgs)
 * without being blocked — never used from the read path.
 */
async function resolveReferenceListId(
  supabase: SupabaseServerClient,
  organizationId: string,
  listKey: string,
  createIfMissing: boolean,
): Promise<
  | { ok: true; id: string; found: boolean; parentListKey: string | null }
  | { ok: false; error: string }
> {
  const { data: existing, error: selectError } = await supabase
    .from("reference_lists")
    .select("id, parent_list_key")
    .eq("list_key", listKey)
    .maybeSingle();

  if (selectError) return { ok: false, error: mapDbError(selectError) };
  if (existing) {
    return {
      ok: true,
      id: existing.id as string,
      found: true,
      parentListKey: (existing.parent_list_key as string | null) ?? null,
    };
  }
  if (!createIfMissing) return { ok: true, id: "", found: false, parentListKey: null };

  const name = listKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const { data: created, error: insertError } = await supabase
    .from("reference_lists")
    .insert({ organization_id: organizationId, list_key: listKey, name })
    .select("id, parent_list_key")
    .single();

  if (insertError) return { ok: false, error: mapDbError(insertError) };
  return {
    ok: true,
    id: created.id as string,
    found: true,
    parentListKey: (created.parent_list_key as string | null) ?? null,
  };
}

/**
 * Defense-in-depth mirror of the DB's `validate_reference_list_item_parent`
 * trigger (see the module comment above): validates `parentItemId` against
 * `ownParentListKey` — the `parent_list_key` of the list `parentItemId` is
 * being set ON (not the parent list itself) — before the insert/update is
 * attempted, so a bad value comes back as a clean field error.
 *
 *  - `ownParentListKey === null` (this item's own list has no dependency
 *    configured): `parentItemId` must be absent.
 *  - `ownParentListKey` is a `list_key` string: `parentItemId` must be
 *    present and must resolve to an item belonging to a list with that
 *    `list_key`. RLS already scopes the lookup to the caller's own
 *    organization (same as every other query in this file), so there's no
 *    separate cross-org check needed here — a cross-org id simply resolves
 *    to nothing, which is handled the same as "wrong list_key".
 */
async function validateDependentParentItem(
  supabase: SupabaseServerClient,
  ownParentListKey: string | null,
  parentItemId: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ownParentListKey === null) {
    if (parentItemId !== undefined) {
      return {
        ok: false,
        error: "This list has no configured parent list, so a parent value cannot be set on its items.",
      };
    }
    return { ok: true };
  }

  if (parentItemId === undefined) {
    return {
      ok: false,
      error: `A parent value from the "${ownParentListKey}" list is required for items on this list.`,
    };
  }

  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, reference_list:reference_lists(list_key)")
    .eq("id", parentItemId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };

  const resolvedParentListKey = (data?.reference_list as unknown as { list_key: string } | null)?.list_key;
  if (!data || resolvedParentListKey !== ownParentListKey) {
    return {
      ok: false,
      error: `Invalid parent value — it must be an existing item from the "${ownParentListKey}" list.`,
    };
  }

  return { ok: true };
}

/**
 * Resolves the `parent_list_key` of the list a given `reference_list_items`
 * row already belongs to — needed by `updateReferenceItem` because it takes
 * a bare item `id` (not a `listKey`), so unlike `createReferenceItem` it has
 * no `listKey` argument to resolve the "own list" from directly.
 */
async function resolveItemOwnParentListKey(
  supabase: SupabaseServerClient,
  itemId: string,
): Promise<{ ok: true; parentListKey: string | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("reference_list:reference_lists(parent_list_key)")
    .eq("id", itemId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return { ok: false, error: "Picklist value not found, or you do not have permission to edit it." };
  }

  const parentListKey =
    (data.reference_list as unknown as { parent_list_key: string | null } | null)?.parent_list_key ?? null;
  return { ok: true, parentListKey };
}

/**
 * Any org member can call this (needed to populate every "select asset
 * type" / "select asset status" / future picklist dropdown). Returns an
 * empty list rather than an error if the org has no `reference_lists` row
 * for `listKey` yet (shouldn't happen for `asset_type`/`asset_status` given
 * the seed trigger, but a brand-new `list_key` with no data yet is not an
 * error condition for a read).
 */
export interface ListReferenceItemsOptions {
  /** Filters to items whose `parent_item_id` equals this value — the
   * cascading-select case: "show me this list's items that belong under
   * this selected item from the parent list" (e.g. `asset_subtype` items
   * under a chosen `asset_type` item). Only meaningful when the list is
   * itself dependent (`parentListKey` in the response is non-null);
   * filtering a non-dependent list by this is a no-op (every item's
   * `parent_item_id` is `null`, so it would just return nothing). */
  parentItemId?: string;
}

export async function listReferenceItems(
  listKey: string,
  options: ListReferenceItemsOptions = {},
): Promise<ActionResult<{ items: ReferenceListItemRecord[]; parentListKey: string | null }>> {
  const listKeyResult = listKeySchema.safeParse(listKey);
  if (!listKeyResult.success) return fail("Invalid list key.");

  if (options.parentItemId !== undefined) {
    const parentItemIdResult = uuidSchema.safeParse(options.parentItemId);
    if (!parentItemIdResult.success) return fail("Invalid parent item id filter.");
  }

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view this picklist.");
  }

  const supabase = await createSupabaseServerClient();

  const listResult = await resolveReferenceListId(
    supabase,
    ctx.context.organizationId,
    listKeyResult.data,
    false,
  );
  if (!listResult.ok) return fail(listResult.error);
  if (!listResult.found) return ok({ items: [], parentListKey: null });

  let query = supabase.from("reference_list_items").select("*").eq("reference_list_id", listResult.id);
  if (options.parentItemId !== undefined) {
    query = query.eq("parent_item_id", options.parentItemId);
  }

  const { data, error } = await query.order("sort_order", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({
    items: (data ?? []) as ReferenceListItemRecord[],
    parentListKey: listResult.parentListKey,
  });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function createReferenceItem(
  listKey: string,
  input: unknown,
): Promise<ActionResult<{ item: ReferenceListItemRecord }>> {
  const listKeyResult = listKeySchema.safeParse(listKey);
  if (!listKeyResult.success) return fail("Invalid list key.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can add picklist values.");
  }

  const parsed = referenceItemCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const listResult = await resolveReferenceListId(
    supabase,
    ctx.context.organizationId,
    listKeyResult.data,
    true,
  );
  if (!listResult.ok) return fail(listResult.error);

  const parentCheck = await validateDependentParentItem(
    supabase,
    listResult.parentListKey,
    parsed.data.parentItemId,
  );
  if (!parentCheck.ok) {
    return fail(parentCheck.error, { parentItemId: [parentCheck.error] });
  }

  const row: Record<string, unknown> = {
    reference_list_id: listResult.id,
    value: parsed.data.value,
    label: parsed.data.label,
    color: parsed.data.color ?? null,
    parent_item_id: parsed.data.parentItemId ?? null,
  };
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from("reference_list_items")
    .insert(row)
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ item: data as ReferenceListItemRecord });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree).
 * `reference_list_id` is intentionally not updatable here — moving an item
 * between lists is meaningless (see design note 4 in the migration) and is
 * excluded from the DB's UPDATE column grant regardless. */
export async function updateReferenceItem(
  id: string,
  input: unknown,
): Promise<ActionResult<{ item: ReferenceListItemRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid item id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can edit picklist values.");
  }

  const parsed = referenceItemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.value !== undefined) row.value = parsed.data.value;
  if (parsed.data.label !== undefined) row.label = parsed.data.label;
  if (parsed.data.color !== undefined) row.color = parsed.data.color ?? null;
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  const supabase = await createSupabaseServerClient();

  // Only resolve + validate the item's own list dependency when the caller
  // is actually touching parentItemId — every other field above needs no
  // extra round trip, same as the rest of this function.
  if (parsed.data.parentItemId !== undefined) {
    const ownListInfo = await resolveItemOwnParentListKey(supabase, idResult.data);
    if (!ownListInfo.ok) return fail(ownListInfo.error);

    const parentCheck = await validateDependentParentItem(
      supabase,
      ownListInfo.parentListKey,
      parsed.data.parentItemId,
    );
    if (!parentCheck.ok) {
      return fail(parentCheck.error, { parentItemId: [parentCheck.error] });
    }

    row.parent_item_id = parsed.data.parentItemId;
  }

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const { data, error } = await supabase
    .from("reference_list_items")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Picklist value not found, or you do not have permission to edit it.");
  return ok({ item: data as ReferenceListItemRecord });
}

/**
 * Owner only. Hard delete. `assets.type_id`/`assets.status_id` have no `on
 * delete cascade`/`set null` (plain FK, default `NO ACTION`), so deleting an
 * item still referenced by an asset is rejected by Postgres with `23503`
 * (foreign_key_violation) — surfaced via `mapDbError` as a clean message
 * rather than a raw constraint error. There is deliberately no dependency-
 * count helper here the way `getClientDependencyCounts` exists for clients
 * (out of scope for this pass) — a delete attempt on an in-use item simply
 * fails cleanly; the frontend can retry after reassigning affected assets.
 */
export async function deleteReferenceItem(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid item id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete picklist values.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reference_list_items")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Picklist value not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
