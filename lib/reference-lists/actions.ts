"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { listKeySchema, referenceItemCreateSchema, referenceItemUpdateSchema } from "./schema";

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
): Promise<{ ok: true; id: string; found: boolean } | { ok: false; error: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("reference_lists")
    .select("id")
    .eq("list_key", listKey)
    .maybeSingle();

  if (selectError) return { ok: false, error: mapDbError(selectError) };
  if (existing) return { ok: true, id: existing.id as string, found: true };
  if (!createIfMissing) return { ok: true, id: "", found: false };

  const name = listKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const { data: created, error: insertError } = await supabase
    .from("reference_lists")
    .insert({ organization_id: organizationId, list_key: listKey, name })
    .select("id")
    .single();

  if (insertError) return { ok: false, error: mapDbError(insertError) };
  return { ok: true, id: created.id as string, found: true };
}

/**
 * Any org member can call this (needed to populate every "select asset
 * type" / "select asset status" / future picklist dropdown). Returns an
 * empty list rather than an error if the org has no `reference_lists` row
 * for `listKey` yet (shouldn't happen for `asset_type`/`asset_status` given
 * the seed trigger, but a brand-new `list_key` with no data yet is not an
 * error condition for a read).
 */
export async function listReferenceItems(
  listKey: string,
): Promise<ActionResult<{ items: ReferenceListItemRecord[] }>> {
  const listKeyResult = listKeySchema.safeParse(listKey);
  if (!listKeyResult.success) return fail("Invalid list key.");

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
  if (!listResult.found) return ok({ items: [] });

  const { data, error } = await supabase
    .from("reference_list_items")
    .select("*")
    .eq("reference_list_id", listResult.id)
    .order("sort_order", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ items: (data ?? []) as ReferenceListItemRecord[] });
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

  const row: Record<string, unknown> = {
    reference_list_id: listResult.id,
    value: parsed.data.value,
    label: parsed.data.label,
    color: parsed.data.color ?? null,
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

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
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
