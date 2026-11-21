"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { assetCreateSchema, assetUpdateSchema } from "./schema";
import {
  ASSET_CLIENT_MOVE_MESSAGE,
  describeAssetOnContract,
  describeSerialInUse,
  type AssetActionResult,
  type AssetErrorInfo,
  type AssetRef,
  type AssetRelation,
  type InactiveAssetOption,
} from "./asset-errors";

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
  /** Derived from the status (`reference_list_items.is_inactive`), read-only (issue #274). Inactive assets
   * are hidden from lists by default and cannot be linked to new work orders/contracts/activities. */
  is_inactive: boolean;
  /** The inactive asset this one succeeds (e.g. at the previous client). */
  previous_asset_id: string | null;
  /** Resolved `previous_asset_id`; null when there is none. Filled by every action in this file. */
  previous_asset: AssetRelation | null;
  /** The asset that succeeds this one (at most one); null when there is none. */
  successor: AssetRelation | null;
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

type ContractLink = Extract<AssetErrorInfo, { code: "asset_on_contract" }>["contracts"][number];

function toRelation(row: Record<string, unknown>): AssetRelation {
  return {
    id: row.id as string,
    name: row.name as string,
    client_id: row.client_id as string,
    client_name: (row.client as { name: string } | null)?.name ?? null,
  };
}

/** Fills `previous_asset` and `successor` on the given records: two bulk queries, not per row. */
async function attachAssetRelations(supabase: SupabaseServerClient, assets: AssetRecord[]): Promise<void> {
  const previousIds = [...new Set(assets.map((a) => a.previous_asset_id).filter((id): id is string => Boolean(id)))];
  const ids = assets.map((a) => a.id);
  const [previous, successors] = await Promise.all([
    previousIds.length > 0
      ? supabase.from("assets").select("id, name, client_id, client:clients(name)").in("id", previousIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length > 0
      ? supabase
          .from("assets")
          .select("id, name, client_id, previous_asset_id, client:clients(name)")
          .in("previous_asset_id", ids)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const previousById = new Map(
    (previous.data ?? []).map((row) => [(row as Record<string, unknown>).id as string, toRelation(row as Record<string, unknown>)]),
  );
  const successorByPrevious = new Map(
    (successors.data ?? []).map((row) => [
      (row as Record<string, unknown>).previous_asset_id as string,
      toRelation(row as Record<string, unknown>),
    ]),
  );
  for (const asset of assets) {
    asset.previous_asset = asset.previous_asset_id ? (previousById.get(asset.previous_asset_id) ?? null) : null;
    asset.successor = successorByPrevious.get(asset.id) ?? null;
  }
}

/** An ACTIVE asset (RLS: same organization) with the same model and serial number, compared
 * case/whitespace-insensitively like the unique index. */
async function findSerialConflict(
  supabase: SupabaseServerClient,
  modelId: string,
  serialNumber: string,
  excludeAssetId: string | null,
): Promise<{ asset: AssetRef; client: AssetRef | null } | null> {
  const trimmed = serialNumber.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  let query = supabase
    .from("assets")
    .select("id, name, serial_number, client:clients(id, name)")
    .eq("model_id", modelId)
    .eq("is_inactive", false)
    // Contains-match so stored leading/trailing whitespace still matches; the exact comparison happens below.
    .ilike("serial_number", `%${escaped}%`)
    .limit(200);
  if (excludeAssetId) query = query.neq("id", excludeAssetId);
  const { data } = await query;
  const wanted = trimmed.toLowerCase();
  const row = ((data ?? []) as unknown as {
    id: string;
    name: string;
    serial_number: string | null;
    client: { id: string; name: string } | null;
  }[]).find((candidate) => (candidate.serial_number ?? "").trim().toLowerCase() === wanted);
  if (!row) return null;
  return { asset: { id: row.id, name: row.name }, client: row.client ? { id: row.client.id, name: row.client.name } : null };
}

/** Open (not removed) links of the given assets and all their component descendants to Draft/Active
 * contracts, one entry per contract. Used to refuse an inactive status with a per-contract message. */
async function findOpenContractLinks(supabase: SupabaseServerClient, rootIds: string[]): Promise<ContractLink[]> {
  const all = new Set<string>(rootIds);
  let frontier = [...rootIds];
  for (let depth = 0; depth < 100 && frontier.length > 0; depth++) {
    const { data } = await supabase.from("asset_components").select("component_asset_id").in("parent_asset_id", frontier);
    frontier = [];
    for (const row of data ?? []) {
      const id = row.component_asset_id as string;
      if (!all.has(id)) {
        all.add(id);
        frontier.push(id);
      }
    }
  }
  const { data } = await supabase
    .from("contract_assets")
    .select("asset_id, asset:assets(name), contract:contracts!inner(id, contract_number, status)")
    .in("asset_id", [...all])
    .is("removed_on", null)
    .in("contract.status", ["draft", "active"]);
  const out: ContractLink[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as {
    asset_id: string;
    asset: { name: string } | null;
    contract: { id: string; contract_number: string; status: "draft" | "active" };
  }[]) {
    if (seen.has(row.contract.id)) continue;
    seen.add(row.contract.id);
    out.push({
      id: row.contract.id,
      number: row.contract.contract_number,
      status: row.contract.status,
      assetId: row.asset_id,
      assetName: row.asset?.name ?? "",
    });
  }
  return out.sort((a, b) => a.number.localeCompare(b.number));
}

/** Maps a DB error of an asset write to a result, with structured info where the UI needs it. */
async function failAssetDbError<T>(
  supabase: SupabaseServerClient,
  error: { code?: string; message: string },
  context: { modelId: string | null; serialNumber: string | null; assetId: string | null },
): Promise<AssetActionResult<T>> {
  const message = error.message ?? "";
  if (error.code === "23505" && message.includes("assets_unique_serial_per_model_idx")) {
    const conflict =
      context.modelId && context.serialNumber
        ? await findSerialConflict(supabase, context.modelId, context.serialNumber, context.assetId)
        : null;
    if (conflict) {
      const info: AssetErrorInfo = { code: "serial_in_use", serialNumber: context.serialNumber ?? "", ...conflict };
      const text = describeSerialInUse(info);
      return { error: text, fieldErrors: { serialNumber: [text] }, errorInfo: info };
    }
    return {
      error: "Another active asset of this model already has this serial number.",
      fieldErrors: { serialNumber: ["Already in use."] },
    };
  }
  if (error.code === "23505" && message.includes("assets_previous_asset_id_unique_idx")) {
    return { error: "That asset already has a successor.", fieldErrors: { previousAssetId: ["Already has a successor."] } };
  }
  if (error.code === "23514") {
    if (message.startsWith("An asset can't move to another client")) {
      return {
        error: ASSET_CLIENT_MOVE_MESSAGE,
        fieldErrors: { siteId: [ASSET_CLIENT_MOVE_MESSAGE] },
        errorInfo: { code: "asset_client_immutable" },
      };
    }
    if (message.startsWith("Remove the asset from contract")) return { error: message };
    if (/previous asset/i.test(message)) return { error: message, fieldErrors: { previousAssetId: [message] } };
  }
  return { error: mapDbError(error) };
}

/** `previousAssetId` must exist in this org, be inactive, not be the asset itself and have no other successor. */
async function validatePreviousAsset(
  supabase: SupabaseServerClient,
  previousAssetId: string,
  selfId: string | null,
): Promise<{ ok: true } | { ok: false; error: string; info?: AssetErrorInfo }> {
  if (selfId && previousAssetId === selfId) return { ok: false, error: "An asset cannot be its own previous asset." };
  const { data, error } = await supabase
    .from("assets")
    .select("id, is_inactive")
    .eq("id", previousAssetId)
    .maybeSingle<{ id: string; is_inactive: boolean }>();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) return { ok: false, error: "The previous asset does not exist, or you do not have access to it." };
  if (!data.is_inactive) return { ok: false, error: "The previous asset must be inactive." };
  let successor = supabase.from("assets").select("id, name").eq("previous_asset_id", previousAssetId).limit(1);
  if (selfId) successor = successor.neq("id", selfId);
  const { data: taken } = await successor;
  const other = (taken ?? [])[0] as AssetRef | undefined;
  if (other) {
    return {
      ok: false,
      error: `That asset already has a successor (${other.name}).`,
      info: { code: "previous_asset_has_successor", asset: other },
    };
  }
  return { ok: true };
}

/** Whether a status item is marked inactive (RLS scopes it to the caller's organization). */
async function statusIsInactive(supabase: SupabaseServerClient, statusId: string): Promise<boolean> {
  const { data } = await supabase
    .from("reference_list_items")
    .select("is_inactive")
    .eq("id", statusId)
    .maybeSingle<{ is_inactive: boolean }>();
  return Boolean(data?.is_inactive);
}

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
    previous_asset_id: input.previousAssetId ?? null,
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
  if (input.previousAssetId !== undefined) row.previous_asset_id = input.previousAssetId;
  return row;
}

export interface ListAssetsOptions {
  clientId?: string;
  siteId?: string;
  limit?: number;
  offset?: number;
  /**
   * List-page filters (web design system list shell). All optional.
   * `search` matches name, serial number, external reference, the type/brand
   * label, the model name and the client name.
   */
  search?: string;
  typeId?: string;
  statusId?: string;
  /** `active` = warranty_until is today or later, `expired` = earlier.
   * Assets without a warranty date match neither. */
  warranty?: "active" | "expired";
  /** Sort column; unknown values fall back to `name`. */
  sort?: "name" | "serial_number" | "installed_at" | "warranty_until";
  direction?: "asc" | "desc";
  /** Issue #274: inactive assets (status marked inactive) are hidden unless true. Not applied when a
   * `statusId` filter is given (explicitly asking for a status shows its assets). Pickers keep the default. */
  includeInactive?: boolean;
  /** Assets that stay in the result even when inactive, e.g. the asset an existing work order/contract/quote/
   * activity already points to, so the record can still show it. */
  includeAssetIds?: string[];
}

const ASSET_SORT_COLUMNS = new Set(["name", "serial_number", "installed_at", "warranty_until"]);

/** Strips characters that would break a PostgREST `or()`/`ilike` pattern. */
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()%*\\"':]/g, " ").replace(/ +/g, " ").trim().slice(0, 80);
}

/** List assets, org-scoped via RLS automatically. Supports filtering by
 * `clientId` and/or `siteId` (both optional, combinable) for the map/list
 * views that scope by client — e.g. `listAssets({ clientId })` for "all
 * assets of this client" or `listAssets({ siteId })` for "all assets at
 * this site". */
export async function listAssets(
  options: ListAssetsOptions = {},
): Promise<
  ActionResult<{
    assets: AssetRecord[];
    count: number;
    /** Only set when a list filter (search/type/status/warranty) was
     * applied: the total before those filters (still scoped by client/site),
     * for the "3 of 12" count. */
    unfilteredCount?: number;
  }>
> {
  if (options.clientId !== undefined) {
    const clientIdResult = uuidSchema.safeParse(options.clientId);
    if (!clientIdResult.success) return fail("Invalid client id filter.");
  }
  if (options.siteId !== undefined) {
    const siteIdResult = uuidSchema.safeParse(options.siteId);
    if (!siteIdResult.success) return fail("Invalid site id filter.");
  }
  for (const [value, message] of [
    [options.typeId, "Invalid type filter."],
    [options.statusId, "Invalid status filter."],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) return fail(message);
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
  // Postgrest builders mutate in place, so the unfiltered count (still scoped
  // by client/site) is its own query.
  let countScoped = supabase.from("assets").select("id", { count: "exact", head: true });
  if (options.clientId) countScoped = countScoped.eq("client_id", options.clientId);
  if (options.siteId) countScoped = countScoped.eq("site_id", options.siteId);
  // Issue #274: hide inactive assets unless asked for (or a status filter is explicit).
  if (!options.includeInactive && !options.statusId) {
    const keepIds = (options.includeAssetIds ?? []).filter((id) => uuidSchema.safeParse(id).success);
    const hide = keepIds.length > 0 ? `is_inactive.eq.false,id.in.(${keepIds.join(",")})` : null;
    if (hide) {
      query = query.or(hide);
      countScoped = countScoped.or(hide);
    } else {
      query = query.eq("is_inactive", false);
      countScoped = countScoped.eq("is_inactive", false);
    }
  }

  const term = sanitizeSearchTerm(options.search ?? "");
  const filtered = Boolean(term || options.typeId || options.statusId || options.warranty);
  if (term) {
    // Client / type / brand / model are other tables: resolve their matches
    // first and fold the ids into the same `or()`.
    const [clientMatches, itemMatches, modelMatches] = await Promise.all([
      supabase.from("clients").select("id").ilike("name", `%${term}%`).limit(100),
      supabase.from("reference_list_items").select("id").ilike("label", `%${term}%`).limit(100),
      supabase.from("asset_models").select("id").ilike("name", `%${term}%`).limit(100),
    ]);
    const ids = (rows: { id: string }[] | null) => (rows ?? []).map((row) => row.id);
    const clientIds = ids(clientMatches.data);
    const itemIds = ids(itemMatches.data);
    const modelIds = ids(modelMatches.data);
    query = query.or(
      [
        `name.ilike.%${term}%`,
        `serial_number.ilike.%${term}%`,
        `external_reference.ilike.%${term}%`,
        ...(clientIds.length > 0 ? [`client_id.in.(${clientIds.join(",")})`] : []),
        ...(itemIds.length > 0
          ? [`type_id.in.(${itemIds.join(",")})`, `brand_item_id.in.(${itemIds.join(",")})`]
          : []),
        ...(modelIds.length > 0 ? [`model_id.in.(${modelIds.join(",")})`] : []),
      ].join(","),
    );
  }
  if (options.typeId) query = query.eq("type_id", options.typeId);
  if (options.statusId) query = query.eq("status_id", options.statusId);
  if (options.warranty) {
    const today = new Date().toISOString().slice(0, 10);
    query = options.warranty === "active" ? query.gte("warranty_until", today) : query.lt("warranty_until", today);
  }

  const sortColumn = options.sort && ASSET_SORT_COLUMNS.has(options.sort) ? options.sort : "name";
  query = query.order(sortColumn, { ascending: options.direction !== "desc", nullsFirst: false });
  if (sortColumn !== "name") query = query.order("name", { ascending: true });

  const [{ data, error, count }, unfiltered] = await Promise.all([
    query.range(offset, offset + limit - 1),
    filtered ? countScoped : Promise.resolve(null),
  ]);
  if (error) return fail(mapDbError(error));
  const assets = (data ?? []) as AssetRecord[];
  await attachAssetRelations(supabase, assets);
  return ok({
    assets,
    count: count ?? 0,
    ...(unfiltered ? { unfilteredCount: unfiltered.count ?? 0 } : {}),
  });
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
  const asset = data as AssetRecord;
  await attachAssetRelations(supabase, [asset]);
  return ok({ asset });
}

/** Owner only (per RBAC matrix + RLS, both agree here — no gap). */
export async function createAsset(input: unknown): Promise<AssetActionResult<{ asset: AssetRecord }>> {
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

  if (parsed.data.previousAssetId !== undefined) {
    const previousCheck = await validatePreviousAsset(supabase, parsed.data.previousAssetId, null);
    if (!previousCheck.ok) {
      return { error: previousCheck.error, fieldErrors: { previousAssetId: [previousCheck.error] }, errorInfo: previousCheck.info };
    }
  }

  // Serial numbers are unique per model among active assets (issue #274).
  if (parsed.data.modelId && parsed.data.serialNumber && !(await statusIsInactive(supabase, parsed.data.statusId))) {
    const conflict = await findSerialConflict(supabase, parsed.data.modelId, parsed.data.serialNumber, null);
    if (conflict) {
      const info: AssetErrorInfo = { code: "serial_in_use", serialNumber: parsed.data.serialNumber, ...conflict };
      const text = describeSerialInUse(info);
      return { error: text, fieldErrors: { serialNumber: [text] }, errorInfo: info };
    }
  }

  const { data, error } = await supabase
    .from("assets")
    .insert(toAssetInsertRow(parsed.data))
    .select(ASSET_SELECT)
    .single();

  if (error) {
    return failAssetDbError(supabase, error, {
      modelId: parsed.data.modelId ?? null,
      serialNumber: parsed.data.serialNumber ?? null,
      assetId: null,
    });
  }
  const asset = data as AssetRecord;
  await attachAssetRelations(supabase, [asset]);
  return ok({ asset });
}

/**
 * Owner-only in practice today — see the "Known gap" module comment above.
 * `can()` allows Planner through at the application layer (matrix says
 * Planner has Assets Read/Update); RLS is what actually still blocks a
 * non-owner write in v1 — live-verified as a silent 0-row update (not a
 * `42501`), which surfaces here as the existing "not found, or you do not
 * have permission" message via the `if (!data)` check.
 */
export async function updateAsset(id: string, input: unknown): Promise<AssetActionResult<{ asset: AssetRecord }>> {
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

  // Current values: needed for the client-immutability, inactive-status and serial pre-checks.
  const { data: current } = await supabase
    .from("assets")
    .select("id, client_id, model_id, serial_number, is_inactive")
    .eq("id", idResult.data)
    .maybeSingle<{ id: string; client_id: string; model_id: string | null; serial_number: string | null; is_inactive: boolean }>();
  if (!current) return fail("Asset not found, or you do not have permission to update it.");

  // An asset never moves to another client (DB-enforced too): only sites of its own client.
  if (parsed.data.siteId !== undefined) {
    const { data: site } = await supabase
      .from("sites")
      .select("client_id")
      .eq("id", parsed.data.siteId)
      .maybeSingle<{ client_id: string }>();
    if (site && site.client_id !== current.client_id) {
      return {
        error: ASSET_CLIENT_MOVE_MESSAGE,
        fieldErrors: { siteId: [ASSET_CLIENT_MOVE_MESSAGE] },
        errorInfo: { code: "asset_client_immutable" },
      };
    }
  }

  // Becoming inactive: refused while the asset (or a component) is on an open Draft/Active contract.
  const willBeInactive =
    parsed.data.statusId !== undefined ? await statusIsInactive(supabase, parsed.data.statusId) : current.is_inactive;
  if (willBeInactive && !current.is_inactive) {
    const contracts = await findOpenContractLinks(supabase, [current.id]);
    if (contracts.length > 0) {
      const info: AssetErrorInfo = { code: "asset_on_contract", contracts };
      const text = describeAssetOnContract(info);
      return { error: text, fieldErrors: { statusId: [text] }, errorInfo: info };
    }
  }

  if (parsed.data.previousAssetId) {
    const previousCheck = await validatePreviousAsset(supabase, parsed.data.previousAssetId, current.id);
    if (!previousCheck.ok) {
      return { error: previousCheck.error, fieldErrors: { previousAssetId: [previousCheck.error] }, errorInfo: previousCheck.info };
    }
  }

  // Serial numbers are unique per model among active assets (issue #274); only checked when the asset ends up active.
  const nextModelId = parsed.data.modelId ?? current.model_id;
  const nextSerial = parsed.data.serialNumber ?? current.serial_number;
  const serialTouched =
    parsed.data.modelId !== undefined || parsed.data.serialNumber !== undefined || (current.is_inactive && !willBeInactive);
  if (serialTouched && !willBeInactive && nextModelId && nextSerial) {
    const conflict = await findSerialConflict(supabase, nextModelId, nextSerial, current.id);
    if (conflict) {
      const info: AssetErrorInfo = { code: "serial_in_use", serialNumber: nextSerial, ...conflict };
      const text = describeSerialInUse(info);
      return { error: text, fieldErrors: { serialNumber: [text] }, errorInfo: info };
    }
  }

  const { data, error } = await supabase
    .from("assets")
    .update(row)
    .eq("id", idResult.data)
    .select(ASSET_SELECT)
    .maybeSingle();

  if (error) {
    return failAssetDbError(supabase, error, { modelId: nextModelId, serialNumber: nextSerial, assetId: current.id });
  }
  if (!data) return fail("Asset not found, or you do not have permission to update it.");
  const asset = data as AssetRecord;
  await attachAssetRelations(supabase, [asset]);
  return ok({ asset });
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

const INACTIVE_OPTION_SELECT =
  "id, name, serial_number, model:asset_models!assets_model_id_fkey(id, name), client:clients(id, name)";

/** Drops options that already have a successor (an asset can have only one), except `keepId`. */
async function withoutSuccessors(
  supabase: SupabaseServerClient,
  rows: InactiveAssetOption[],
  keepId: string | null,
): Promise<InactiveAssetOption[]> {
  if (rows.length === 0) return rows;
  const { data } = await supabase
    .from("assets")
    .select("previous_asset_id")
    .in(
      "previous_asset_id",
      rows.map((r) => r.id),
    );
  const taken = new Set((data ?? []).map((r) => r.previous_asset_id as string));
  return rows.filter((r) => r.id === keepId || !taken.has(r.id));
}

/**
 * Inactive assets (org-wide, any client) for the "Previous asset" picker (issue #274). Assets that already have
 * a successor are left out, except `currentPreviousId` (the value currently selected on the form). `excludeAssetId`
 * leaves out the asset being edited. At most 50 rows, ordered by name.
 */
export async function listInactiveAssetOptions(
  search?: string,
  options: { excludeAssetId?: string; currentPreviousId?: string } = {},
): Promise<ActionResult<{ options: InactiveAssetOption[] }>> {
  for (const value of [options.excludeAssetId, options.currentPreviousId]) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) return fail("Invalid asset id.");
  }
  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view assets.");
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("assets").select(INACTIVE_OPTION_SELECT).eq("is_inactive", true);
  if (options.excludeAssetId) query = query.neq("id", options.excludeAssetId);
  const term = sanitizeSearchTerm(search ?? "");
  if (term) {
    const { data: clientMatches } = await supabase.from("clients").select("id").ilike("name", `%${term}%`).limit(100);
    const clientIds = (clientMatches ?? []).map((row) => row.id as string);
    query = query.or(
      [
        `name.ilike.%${term}%`,
        `serial_number.ilike.%${term}%`,
        ...(clientIds.length > 0 ? [`client_id.in.(${clientIds.join(",")})`] : []),
      ].join(","),
    );
  }
  const { data, error } = await query.order("name", { ascending: true }).limit(100);
  if (error) return fail(mapDbError(error));
  const rows = await withoutSuccessors(
    supabase,
    (data ?? []) as unknown as InactiveAssetOption[],
    options.currentPreviousId ?? null,
  );
  return ok({ options: rows.slice(0, 50) });
}

/**
 * The inactive asset of the same model and serial number (case/whitespace-insensitive) that has no successor
 * yet, for the inline suggestion "This serial number belongs to inactive asset <x> (<client>). Link it as
 * previous asset?" (issue #274). `null` when there is none or the input is incomplete.
 */
export async function findInactiveAssetMatch(
  modelId: string,
  serialNumber: string,
  excludeAssetId?: string,
): Promise<ActionResult<{ match: InactiveAssetOption | null }>> {
  if (!uuidSchema.safeParse(modelId).success) return fail("Invalid model id.");
  if (excludeAssetId !== undefined && !uuidSchema.safeParse(excludeAssetId).success) return fail("Invalid asset id.");
  const trimmed = serialNumber.trim();
  if (!trimmed) return ok({ match: null });

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view assets.");
  }

  const supabase = await createSupabaseServerClient();
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  let query = supabase
    .from("assets")
    .select(INACTIVE_OPTION_SELECT)
    .eq("is_inactive", true)
    .eq("model_id", modelId)
    .ilike("serial_number", escaped)
    .limit(10);
  if (excludeAssetId) query = query.neq("id", excludeAssetId);
  const { data, error } = await query;
  if (error) return fail(mapDbError(error));
  const rows = await withoutSuccessors(supabase, (data ?? []) as unknown as InactiveAssetOption[], null);
  return ok({ match: rows[0] ?? null });
}
