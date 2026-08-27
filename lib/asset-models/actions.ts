"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { z } from "zod";
import { assetModelCreateSchema, assetModelUpdateSchema } from "./schema";

/**
 * Server Actions for `public.asset_models` (issue #54 — "Als gebruiker wil
 * ik referentietabellen kunnen beheren voor Assets", the Model half). Same
 * four-step preamble as every other module's actions (module context ->
 * `can()` -> Zod validation -> query under the caller's own session) — see
 * the block comment at the top of `lib/reference-lists/actions.ts`, this
 * file's direct template.
 *
 * Deliberately its own `lib/asset-models/` module, NOT under
 * `app/(app)/assets/` — same reasoning `lib/reference-lists/actions.ts`'s
 * own doc comment gives for itself: this is reference/config data (a
 * tenant-configurable "what models exist" catalog), not the Assets module's
 * own operational data (individual physical asset records).
 *
 * `asset_models` is a dedicated table, not another `reference_list_items`
 * row (see the design note at the top of
 * `supabase/migrations/20260826160000_asset_brand_and_models.sql`), so this
 * module doesn't reuse `lib/reference-lists/actions.ts`'s generic
 * `listReferenceItems`/`createReferenceItem`/etc — it has its own three
 * simultaneous FK relationships (brand/type/subtype) plus a typed
 * `default_warranty_months` column that mechanism has nowhere to hang.
 *
 * RBAC: reuses the existing `"settings"` module (owner: CRUD, every other
 * tenant role: `read`) — same boundary as every other reference-list-style
 * action, and matches this table's RLS exactly (select: any member;
 * insert/update/delete: owner only), so there is no "allowed by `can()`,
 * silently rejected by RLS" gap to document here either.
 */

/** Resolved (embedded) shape of a `reference_list_items` row — just enough
 * for a label/badge in the UI, same shape `app/(app)/assets/actions.ts`'s
 * `ResolvedReferenceItem` uses for `asset_type`/`asset_status`/`asset_subtype`. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface AssetModelRecord {
  id: string;
  organization_id: string;
  brand_item_id: string;
  type_item_id: string;
  subtype_item_id: string | null;
  name: string;
  default_warranty_months: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!asset_models_brand_item_id_fkey(...)`
   * — see `ASSET_MODEL_SELECT` below. */
  brand: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!asset_models_type_item_id_fkey(...)`. */
  type: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!asset_models_subtype_item_id_fkey(...)`.
   * `null` whenever `subtype_item_id` is `null`. */
  subtype: ResolvedReferenceItem | null;
}

/**
 * `asset_models` has three FKs into `reference_list_items` (brand/type/
 * subtype), so PostgREST needs the exact FK constraint name to disambiguate
 * each embed — same "confirmed live against Postgres's default unnamed-FK
 * naming (`<table>_<column>_fkey`)" reasoning `app/(app)/assets/actions.ts`'s
 * own `ASSET_SELECT` comment documents for `assets_type_id_fkey` etc.
 */
const ASSET_MODEL_SELECT =
  "*, brand:reference_list_items!asset_models_brand_item_id_fkey(value,label,color), type:reference_list_items!asset_models_type_item_id_fkey(value,label,color), subtype:reference_list_items!asset_models_subtype_item_id_fkey(value,label,color)";

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ReferenceItemLookup = { id: string; parent_item_id: string | null; reference_list: { list_key: string } | null };

async function fetchReferenceItem(
  supabase: SupabaseServerClient,
  itemId: string,
): Promise<{ ok: true; item: ReferenceItemLookup | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, parent_item_id, reference_list:reference_lists(list_key)")
    .eq("id", itemId)
    .maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  return { ok: true, item: data as unknown as ReferenceItemLookup | null };
}

/**
 * Defense-in-depth mirror of the DB's `validate_asset_model_reference_items`
 * trigger (see the migration's doc comment) — validates `brandItemId`
 * resolves to an `asset_brand` item, `typeItemId` to an `asset_type` item,
 * and (when present) `subtypeItemId` to an `asset_subtype` item whose own
 * `parent_item_id` equals `typeItemId`, *before* the insert/update is
 * attempted, so a bad value comes back as a clean field error instead of the
 * DB's generic `23514` message. Unlike `app/(app)/assets/actions.ts`'s
 * `validateAssetSubtype` (which deliberately leaves the subtype/type
 * cross-field check to the DB trigger alone), this DOES duplicate that
 * cross-field check client-side too — this issue's own acceptance criteria
 * calls out the Type-change-clears-Sub-type cascade UX explicitly, so a
 * stale, now-mismatched Sub-type should read as an ordinary form validation
 * error, not a raw mapped Postgres error. RLS already scopes every lookup to
 * the caller's own organization (same as `validateDependentParentItem` in
 * `lib/reference-lists/actions.ts`), so a cross-org id simply resolves to
 * "not found" here — no separate org check needed.
 */
async function validateAssetModelReferenceItems(
  supabase: SupabaseServerClient,
  input: { brandItemId: string; typeItemId: string; subtypeItemId?: string },
): Promise<
  | { ok: true }
  | { ok: false; error: string; field: "brandItemId" | "typeItemId" | "subtypeItemId" }
> {
  const brandResult = await fetchReferenceItem(supabase, input.brandItemId);
  if (!brandResult.ok) return { ok: false, error: brandResult.error, field: "brandItemId" };
  if (!brandResult.item || brandResult.item.reference_list?.list_key !== "asset_brand") {
    return {
      ok: false,
      error: "Invalid brand — it must be a value from the Asset Brand list.",
      field: "brandItemId",
    };
  }

  const typeResult = await fetchReferenceItem(supabase, input.typeItemId);
  if (!typeResult.ok) return { ok: false, error: typeResult.error, field: "typeItemId" };
  if (!typeResult.item || typeResult.item.reference_list?.list_key !== "asset_type") {
    return {
      ok: false,
      error: "Invalid type — it must be a value from the Asset Type list.",
      field: "typeItemId",
    };
  }

  if (input.subtypeItemId !== undefined) {
    const subtypeResult = await fetchReferenceItem(supabase, input.subtypeItemId);
    if (!subtypeResult.ok) return { ok: false, error: subtypeResult.error, field: "subtypeItemId" };
    if (!subtypeResult.item || subtypeResult.item.reference_list?.list_key !== "asset_subtype") {
      return {
        ok: false,
        error: "Invalid sub-type — it must be a value from the Asset Sub-type list.",
        field: "subtypeItemId",
      };
    }
    if (subtypeResult.item.parent_item_id !== input.typeItemId) {
      return {
        ok: false,
        error: "Invalid sub-type — it must belong under the selected Type.",
        field: "subtypeItemId",
      };
    }
  }

  return { ok: true };
}

export interface ListAssetModelsOptions {
  /** Cascading-select filter — only models with this exact `brand_item_id`. */
  brandItemId?: string;
  /** Cascading-select filter — only models with this exact `type_item_id`. */
  typeItemId?: string;
}

/** Any org member can call this (needed to populate the Model manager table,
 * and later issue #53's Asset form Model picker). */
export async function listAssetModels(
  options: ListAssetModelsOptions = {},
): Promise<ActionResult<{ models: AssetModelRecord[] }>> {
  if (options.brandItemId !== undefined && !uuidSchema.safeParse(options.brandItemId).success) {
    return fail("Invalid brand filter.");
  }
  if (options.typeItemId !== undefined && !uuidSchema.safeParse(options.typeItemId).success) {
    return fail("Invalid type filter.");
  }

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view asset models.");
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("asset_models").select(ASSET_MODEL_SELECT);
  if (options.brandItemId !== undefined) query = query.eq("brand_item_id", options.brandItemId);
  if (options.typeItemId !== undefined) query = query.eq("type_item_id", options.typeItemId);

  const { data, error } = await query.order("name", { ascending: true });
  if (error) return fail(mapDbError(error));
  return ok({ models: (data ?? []) as unknown as AssetModelRecord[] });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function createAssetModel(input: unknown): Promise<ActionResult<{ model: AssetModelRecord }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can add asset models.");
  }

  const parsed = assetModelCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const refCheck = await validateAssetModelReferenceItems(supabase, parsed.data);
  if (!refCheck.ok) {
    return fail(refCheck.error, { [refCheck.field]: [refCheck.error] });
  }

  const row = {
    organization_id: ctx.context.organizationId,
    brand_item_id: parsed.data.brandItemId,
    type_item_id: parsed.data.typeItemId,
    subtype_item_id: parsed.data.subtypeItemId ?? null,
    name: parsed.data.name,
    default_warranty_months: parsed.data.defaultWarrantyMonths ?? 24,
  };

  const { data, error } = await supabase.from("asset_models").insert(row).select(ASSET_MODEL_SELECT).single();

  if (error) return fail(mapDbError(error));
  return ok({ model: data as unknown as AssetModelRecord });
}

/**
 * Owner only. Full-replace, not a partial update — see the doc comment atop
 * `lib/asset-models/schema.ts`'s `assetModelUpdateSchema` for why: this
 * dialog always submits the whole record (create or edit alike), so every
 * field here is always written from what the form sent, including
 * `subtype_item_id` explicitly going back to `null` when the caller clears
 * it (e.g. the "changing Type clears a previously-selected Sub-type"
 * cascade) — never conditionally skipped the way most of this codebase's
 * other `update*` actions skip an `undefined` field.
 */
export async function updateAssetModel(
  id: string,
  input: unknown,
): Promise<ActionResult<{ model: AssetModelRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset model id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can edit asset models.");
  }

  const parsed = assetModelUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const refCheck = await validateAssetModelReferenceItems(supabase, parsed.data);
  if (!refCheck.ok) {
    return fail(refCheck.error, { [refCheck.field]: [refCheck.error] });
  }

  const row = {
    brand_item_id: parsed.data.brandItemId,
    type_item_id: parsed.data.typeItemId,
    subtype_item_id: parsed.data.subtypeItemId ?? null,
    name: parsed.data.name,
    default_warranty_months: parsed.data.defaultWarrantyMonths,
  };

  const { data, error } = await supabase
    .from("asset_models")
    .update(row)
    .eq("id", idResult.data)
    .select(ASSET_MODEL_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset model not found, or you do not have permission to edit it.");
  return ok({ model: data as unknown as AssetModelRecord });
}

/**
 * Owner only. Hard delete. `asset_models` has no incoming FK from anything
 * yet (issue #53's Asset form Model picker is on hold, per this issue's own
 * brief), so there is no dependency-count concern to surface today — a
 * future `assets.model_id` FK would need the same "delete fails cleanly via
 * `23503`, mapped by `mapDbError`" treatment `deleteReferenceItem` already
 * documents for itself.
 */
export async function deleteAssetModel(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset model id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete asset models.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("asset_models")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset model not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
