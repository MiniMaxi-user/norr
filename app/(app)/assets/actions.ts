"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { assetCreateSchema, assetUpdateSchema } from "./schema";

/**
 * Server Actions for the Assets module, issue #9 backend half. Same shape
 * and preamble pattern as `app/(app)/clients/actions.ts` — see the block
 * comment at the top of that file for the general rules (module context ->
 * `can()`/`canAny()` -> Zod validation -> query under the caller's own
 * session).
 *
 * RBAC recap for `assets` (lib/rbac/permissions.ts): `owner` has CRUD;
 * `planner` has `read` + `update` (no create/delete); `engineer` has only
 * `read_own`/`update_own` ("Read/Update (assigned)" in the matrix — no
 * assignment concept exists on `assets` yet, same caveat as `clients`, see
 * that file's module comment); `finance`/`administratie` have `read` only.
 *
 * *** Known gap: Planner asset UPDATE is allowed by `can()` but silently
 * rejected by RLS today. ***
 * `supabase/migrations/20260822190000_clients_sites_assets.sql` design note
 * 2 documents this: RLS INSERT/UPDATE/DELETE on `assets` is currently
 * `is_org_owner(organization_id)` only, for every action, even though the
 * RBAC matrix grants Planner "Read/Update". Per this feature's task
 * instructions and CLAUDE.md rule 1 ("no service-role shortcuts from client
 * code" / "no exceptions"), `updateAsset` below does NOT work around this
 * with a service-role bypass. Instead:
 *   - `can(actor, "assets", "update")` is checked as-is (this intentionally
 *     returns `true` for a Planner, since the matrix really does grant it —
 *     CLAUDE.md rule 2 forbids special-casing `role === "planner"` here to
 *     preemptively reject it before even asking `can()`).
 *   - The UPDATE is attempted under the caller's own session regardless.
 *   - Live-verified against the linked Supabase project (test users +
 *     direct REST calls, cleaned up after): a Planner's UPDATE on an asset
 *     does NOT raise a `42501` error. Postgres RLS `USING` clause violations
 *     on UPDATE are silently excluded (0 rows affected) rather than erroring
 *     — `42501` is only raised for `WITH CHECK` violations or an outright
 *     missing column-level grant, neither of which applies here (Planner
 *     does have UPDATE-privilege on these columns; it's the `USING
 *     (is_org_owner(organization_id))` row filter that excludes the row).
 *     supabase-js's `.update(...).select("*").maybeSingle()` therefore comes
 *     back as `{ data: null, error: null }` for a Planner's attempt — which
 *     the `if (!data) return fail(...)` check below already handles
 *     correctly, no extra branch needed. (Note: this contradicts the
 *     `throws_ok(..., '42501', ...)` assertion for the equivalent Planner
 *     case in `supabase/tests/database/clients_sites_assets_rls.test.sql` —
 *     that pgTAP test looks stale/incorrect against actual behavior; flagged
 *     here for `db-schema-architect`/`qa-reviewer`, not fixed in this file.)
 *   - Practically: only `owner` sessions can successfully update an asset
 *     today. Planner support is blocked on Phase 2 RLS work (assignment-
 *     based scoping), not on anything in this file.
 */

/** Resolved (embedded) shape of a `reference_list_items` row, as returned by
 * the `asset_type`/`asset_status` embeds below — just enough for a picklist
 * badge/label in the UI, not the full row (id/list membership are already
 * known from the `list_key` that was embedded on). */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface AssetRecord {
  id: string;
  organization_id: string;
  client_id: string;
  site_id: string;
  name: string;
  type_id: string;
  /** Free-text external/legacy reference. No FK, no validation — see
   * `schema.ts`'s `externalReference` field comment. */
  external_reference: string | null;
  /** FK into this org's `asset_brand` reference list. Nullable — Brand is
   * not required at the asset level. Replaces the old free-text
   * `manufacturer` column. */
  brand_item_id: string | null;
  /** FK into `asset_models`. Nullable. Replaces the old free-text `model`
   * column. */
  model_id: string | null;
  serial_number: string | null;
  status_id: string;
  /** FK into this org's `asset_subtype` reference list. Nullable — not every
   * asset needs a sub-type, unlike `type_id`. See the comment on
   * `subtypeId` in `./schema.ts` for the dependent-list validation split
   * (shape here, cross-field "must be a sub-type of type_id" at the DB). */
  subtype_id: string | null;
  installed_at: string | null;
  warranty_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!assets_type_id_fkey(...)` — see
   * `ASSET_SELECT` below. `null` only if `type_id` somehow no longer
   * resolves (shouldn't happen; `type_id` is `not null` with no `on delete`
   * cascade/set-null from `reference_list_items`, so an item an asset points
   * to can't currently be deleted out from under it). */
  asset_type: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!assets_status_id_fkey(...)`. */
  asset_status: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!assets_subtype_id_fkey(...)`. `null`
   * whenever `subtype_id` is `null` (no sub-type set on this asset). */
  asset_subtype: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!assets_brand_item_id_fkey(...)`.
   * `null` whenever `brand_item_id` is `null`. */
  asset_brand: ResolvedReferenceItem | null;
  /**
   * Embedded via `asset_models!assets_model_id_fkey(...)`. `null` whenever
   * `model_id` is `null`. Deliberately a SHALLOW embed (id/name/
   * default_warranty_months only), not a further nested embed of the
   * model's own brand/type/subtype reference items: PostgREST supports
   * multi-level embeds, but a three-way nested embed here (assets ->
   * asset_models -> reference_list_items x3, each needing its own FK-name
   * disambiguation) would duplicate data the frontend already gets, fully
   * resolved, from `listAssetModels()` in `lib/asset-models/actions.ts`
   * (which returns `brand_item_id`/`type_item_id`/`subtype_item_id` plus
   * their resolved labels for every model in one call). The "select a
   * Model, auto-fill Type/Sub-type/Brand" cascade the frontend needs is
   * therefore a client-side cross-reference against that already-fetched
   * model list, not something this query needs to duplicate. This shallow
   * embed exists only so list/detail views can show the Model's name
   * without a second round trip.
   */
  asset_model: { id: string; name: string; default_warranty_months: number } | null;
}

/**
 * Shared select shape for every query that returns an `AssetRecord`, so the
 * frontend gets the resolved type/label/color for both `type_id` and
 * `status_id` in one round trip instead of N+1-ing a lookup per row per
 * column. `assets` has two FKs into `reference_list_items` (`type_id` and
 * `status_id`), so PostgREST needs the exact FK constraint name to
 * disambiguate each embed (`!assets_type_id_fkey` / `!assets_status_id_fkey`
 * — confirmed live against the linked project's auto-generated constraint
 * names from `alter table assets add column type_id uuid references
 * reference_list_items (id)` in
 * supabase/migrations/20260822200000_reference_lists.sql; Postgres's default
 * naming for an unnamed column FK is `<table>_<column>_fkey`). Extended
 * (issue #26) with a third embed, `asset_subtype`, via
 * `assets_subtype_id_fkey` — same default-naming reasoning, added by
 * `alter table assets add column subtype_id uuid references
 * reference_list_items (id)` in
 * supabase/migrations/20260823090000_contacts_dependent_reference_lists.sql.
 * Extended (issue #53) with two more embeds for the new `brand_item_id`/
 * `model_id` columns added in
 * `supabase/migrations/20260826170000_assets_external_reference_brand_model.sql`:
 * `asset_brand` via `assets_brand_item_id_fkey` (same reference_list_items
 * pattern as the three embeds above) and `asset_model` via
 * `assets_model_id_fkey`, this time into the `asset_models` table rather
 * than `reference_list_items` — a shallow embed only (see the `asset_model`
 * field comment on `AssetRecord` above for why it doesn't also nest that
 * model's own brand/type/subtype). Both FK names confirmed live against the
 * linked project (`fxpjzcyeevtaadexnkub`) via
 * `select conname from pg_constraint where conname in
 * ('assets_brand_item_id_fkey', 'assets_model_id_fkey')`, same discipline
 * as the original comment's confirmation of `assets_type_id_fkey` etc.
 */
const ASSET_SELECT =
  "*, asset_type:reference_list_items!assets_type_id_fkey(value,label,color), asset_status:reference_list_items!assets_status_id_fkey(value,label,color), asset_subtype:reference_list_items!assets_subtype_id_fkey(value,label,color), asset_brand:reference_list_items!assets_brand_item_id_fkey(value,label,color), asset_model:asset_models!assets_model_id_fkey(id,name,default_warranty_months)";

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Defense-in-depth shape check for `subtypeId`, mirrored from the same
 * pattern in `lib/reference-lists/actions.ts`'s `validateDependentParentItem`:
 * confirms the id resolves to an item on the `asset_subtype` list (RLS
 * already scopes the lookup to the caller's own organization) *before* the
 * insert/update is attempted, so an id from the wrong list (or a
 * nonexistent one) comes back as a clean field error instead of the DB's
 * generic `23514` message. The cross-field check — that the subtype's own
 * `parent_item_id` actually equals this asset's `type_id` — is deliberately
 * NOT duplicated here (per this task's scope): that's left to
 * `validate_asset_reference_items`, which `mapDbError` already turns into a
 * clean "wrong picklist" style message on `23514`.
 */
async function validateAssetSubtype(
  supabase: SupabaseServerClient,
  subtypeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, reference_list:reference_lists(list_key)")
    .eq("id", subtypeId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };

  const listKey = (data?.reference_list as unknown as { list_key: string } | null)?.list_key;
  if (!data || listKey !== "asset_subtype") {
    return { ok: false, error: "Invalid asset sub-type — it must be a value from the Asset Sub-type list." };
  }

  return { ok: true };
}

/**
 * Defense-in-depth shape check for `brandItemId`, same pattern as
 * `validateAssetSubtype` immediately above: confirms the id resolves to an
 * item on the `asset_brand` list (RLS already scopes the lookup to the
 * caller's own organization) before the insert/update is attempted, so a
 * bad value comes back as a clean field error instead of the DB's generic
 * `23514` message from `validate_asset_reference_items`.
 */
async function validateAssetBrand(
  supabase: SupabaseServerClient,
  brandItemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, reference_list:reference_lists(list_key)")
    .eq("id", brandItemId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };

  const listKey = (data?.reference_list as unknown as { list_key: string } | null)?.list_key;
  if (!data || listKey !== "asset_brand") {
    return { ok: false, error: "Invalid brand — it must be a value from the Asset Brand list." };
  }

  return { ok: true };
}

/**
 * Defense-in-depth existence check for `modelId`. Unlike `validateAssetBrand`/
 * `validateAssetSubtype`, there is no `list_key` to check — `asset_models`
 * is its own dedicated table, not a `reference_list_items` row (see
 * `supabase/migrations/20260826160000_asset_brand_and_models.sql`'s design
 * note) — so this is a plain existence check. RLS already scopes the lookup
 * to the caller's own organization, matching
 * `validate_asset_reference_items`'s own `model_id` check (organization
 * match only, deliberately not cross-checked against this asset's own
 * type/subtype/brand — see design note 3 in
 * `20260826170000_assets_external_reference_brand_model.sql`).
 */
async function validateAssetModel(
  supabase: SupabaseServerClient,
  modelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("asset_models").select("id").eq("id", modelId).maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return { ok: false, error: "Invalid model — it does not exist, or you do not have access to it." };
  }

  return { ok: true };
}

function toAssetInsertRow(input: ReturnType<typeof assetCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    site_id: input.siteId,
    name: input.name,
    type_id: input.typeId,
    external_reference: input.externalReference ?? null,
    brand_item_id: input.brandItemId ?? null,
    model_id: input.modelId ?? null,
    serial_number: input.serialNumber ?? null,
    subtype_id: input.subtypeId ?? null,
    installed_at: input.installedAt ?? null,
    warranty_until: input.warrantyUntil ?? null,
    notes: input.notes ?? null,
  };
  // status_id is intentionally omitted (not even sent as null) when not
  // provided — the `derive_asset_org_and_client` DB trigger fills in the
  // organization's default `asset_status` item on insert. Sending an
  // explicit `null` would be a valid column value at the DB layer today
  // (the trigger only fills it in `if new.status_id is null`, which an
  // explicit null also satisfies) but omitting it is clearer intent and
  // matches "no default supplied" rather than "default to null".
  if (input.statusId !== undefined) row.status_id = input.statusId;
  return row;
}

function toAssetUpdateRow(input: ReturnType<typeof assetUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.siteId !== undefined) row.site_id = input.siteId;
  if (input.name !== undefined) row.name = input.name;
  if (input.typeId !== undefined) row.type_id = input.typeId;
  if (input.externalReference !== undefined) row.external_reference = input.externalReference ?? null;
  if (input.brandItemId !== undefined) row.brand_item_id = input.brandItemId ?? null;
  if (input.modelId !== undefined) row.model_id = input.modelId ?? null;
  if (input.serialNumber !== undefined) row.serial_number = input.serialNumber ?? null;
  if (input.statusId !== undefined) row.status_id = input.statusId;
  if (input.subtypeId !== undefined) row.subtype_id = input.subtypeId ?? null;
  if (input.installedAt !== undefined) row.installed_at = input.installedAt ?? null;
  if (input.warrantyUntil !== undefined) row.warranty_until = input.warrantyUntil ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

export interface ListAssetsOptions {
  clientId?: string;
  siteId?: string;
  limit?: number;
  offset?: number;
}

/** List assets, org-scoped via RLS automatically. Supports filtering by
 * `clientId` and/or `siteId` (both optional, combinable) for the map/list
 * views that scope by client — e.g. `listAssets({ clientId })` for "all
 * assets of this client" or `listAssets({ siteId })` for "all assets at
 * this site". */
export async function listAssets(
  options: ListAssetsOptions = {},
): Promise<ActionResult<{ assets: AssetRecord[]; count: number }>> {
  if (options.clientId !== undefined) {
    const clientIdResult = uuidSchema.safeParse(options.clientId);
    if (!clientIdResult.success) return fail("Invalid client id filter.");
  }
  if (options.siteId !== undefined) {
    const siteIdResult = uuidSchema.safeParse(options.siteId);
    if (!siteIdResult.success) return fail("Invalid site id filter.");
  }

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view assets.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("assets").select(ASSET_SELECT, { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.siteId) query = query.eq("site_id", options.siteId);
  query = query.order("name", { ascending: true }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ assets: (data ?? []) as AssetRecord[], count: count ?? 0 });
}

export async function getAsset(id: string): Promise<ActionResult<{ asset: AssetRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view this asset.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("assets").select(ASSET_SELECT).eq("id", idResult.data).maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found.");
  return ok({ asset: data as AssetRecord });
}

/** Owner only (per RBAC matrix + RLS, both agree here — no gap). */
export async function createAsset(input: unknown): Promise<ActionResult<{ asset: AssetRecord }>> {
  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "create")) {
    return fail("Only the organization owner can create assets.");
  }

  const parsed = assetCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.subtypeId !== undefined) {
    const subtypeCheck = await validateAssetSubtype(supabase, parsed.data.subtypeId);
    if (!subtypeCheck.ok) {
      return fail(subtypeCheck.error, { subtypeId: [subtypeCheck.error] });
    }
  }

  if (parsed.data.brandItemId !== undefined) {
    const brandCheck = await validateAssetBrand(supabase, parsed.data.brandItemId);
    if (!brandCheck.ok) {
      return fail(brandCheck.error, { brandItemId: [brandCheck.error] });
    }
  }

  if (parsed.data.modelId !== undefined) {
    const modelCheck = await validateAssetModel(supabase, parsed.data.modelId);
    if (!modelCheck.ok) {
      return fail(modelCheck.error, { modelId: [modelCheck.error] });
    }
  }

  const { data, error } = await supabase
    .from("assets")
    .insert(toAssetInsertRow(parsed.data))
    .select(ASSET_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ asset: data as AssetRecord });
}

/**
 * Owner-only in practice today — see the "Known gap" module comment above.
 * `can()` allows Planner through at the application layer (matrix says
 * Planner has Assets Read/Update); RLS is what actually still blocks a
 * non-owner write in v1 — live-verified as a silent 0-row update (not a
 * `42501`), which surfaces here as the existing "not found, or you do not
 * have permission" message via the `if (!data)` check.
 */
export async function updateAsset(id: string, input: unknown): Promise<ActionResult<{ asset: AssetRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "update")) {
    return fail("You do not have permission to update assets.");
  }

  const parsed = assetUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toAssetUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.subtypeId !== undefined) {
    const subtypeCheck = await validateAssetSubtype(supabase, parsed.data.subtypeId);
    if (!subtypeCheck.ok) {
      return fail(subtypeCheck.error, { subtypeId: [subtypeCheck.error] });
    }
  }

  if (parsed.data.brandItemId !== undefined) {
    const brandCheck = await validateAssetBrand(supabase, parsed.data.brandItemId);
    if (!brandCheck.ok) {
      return fail(brandCheck.error, { brandItemId: [brandCheck.error] });
    }
  }

  if (parsed.data.modelId !== undefined) {
    const modelCheck = await validateAssetModel(supabase, parsed.data.modelId);
    if (!modelCheck.ok) {
      return fail(modelCheck.error, { modelId: [modelCheck.error] });
    }
  }

  const { data, error } = await supabase
    .from("assets")
    .update(row)
    .eq("id", idResult.data)
    .select(ASSET_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found, or you do not have permission to update it.");
  return ok({ asset: data as AssetRecord });
}

/** Owner only (per RBAC matrix + RLS, both agree — Planner has no `delete`
 * action on `assets` at all in the matrix, so there is no gap to document
 * here the way there is for `updateAsset`). */
export async function deleteAsset(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "delete")) {
    return fail("Only the organization owner can delete assets.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assets")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
