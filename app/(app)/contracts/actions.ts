"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { contractCreateSchema, contractUpdateSchema } from "./schema";

/**
 * Server Actions for the Contracts module (issue #33 backend half, second
 * stage) — a new top-level module (same tier as Clients/Assets/Work Orders),
 * covering the `contracts` entity and its `contract_assets` many-to-many
 * link. Same four-step preamble as every other module's actions (see the
 * block comment at the top of `app/(app)/clients/actions.ts`): resolve
 * module context (`hasFeature` + RBAC actor) -> `can()`/`canAny()` -> Zod
 * validation -> query under the caller's own session (RLS is always the
 * real backstop).
 *
 * RBAC recap for `contracts` (lib/rbac/permissions.ts, matches
 * docs/ARCHITECTURE.md matrix): `owner`/`finance` have CRUD (all rows);
 * `planner`/`engineer`/`administratie` have plain `read` (all rows) — no
 * `_own`-suffixed actions on this module at all, unlike Work Orders'
 * engineer split. `canAny(actor, "contracts", ["read"])` (not
 * `["read", "read_own"]`) reflects that directly: there is no ownership
 * concept to additionally scope by here.
 *
 * *** This is the SECOND module (after `planning`/`work_orders`) where RLS
 * enforces the role split for real, not just the application layer. ***
 * `supabase/migrations/20260823150000_contracts_core.sql` implements the
 * `contracts` matrix row directly in Postgres via `current_member_role`, on
 * both `contracts` and `contract_assets`:
 *  - SELECT: any org member, all rows (no `_own` scoping to replicate).
 *  - INSERT/UPDATE/DELETE: owner or finance only
 *    (`current_member_role(organization_id) in ('owner', 'finance')`).
 * `can()`/`canAny()` here still matter independently of RLS agreeing: they
 * gate which actions exist at all for a role (correctly rejecting a
 * planner's `createContract`/`deleteContract`/`linkContractAsset` attempt
 * before ever hitting the DB) and drive UI affordances.
 *
 * No app-layer pre-validation of `slaTierId`'s dependent-list relationship to
 * `typeId` (unlike `assets.subtypeId`'s `validateAssetSubtype` shape check
 * in `app/(app)/assets/actions.ts`) — same trust boundary
 * `work_orders.siteId`/`assetId` already use: the cross-field check is left
 * entirely to the `validate_contract_reference_items` DB trigger, whose
 * `23503`/`23514` is mapped to a clean message by `mapDbError`, not
 * pre-empted with an extra round trip. Same reasoning applies to
 * `linkContractAsset`'s `assetId` (the asset's `client_id` must match the
 * contract's own `client_id` — checked by `validate_contract_asset_relations`).
 */

/** Resolved (embedded) shape of a `reference_list_items` row — mirrors
 * `ResolvedReferenceItem` in `app/(app)/work-orders/actions.ts`/
 * `app/(app)/assets/actions.ts`; kept as a local copy rather than a shared
 * import, same "each module owns its own" pattern those files establish. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

export interface ContractRecord {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  type_id: string;
  sla_tier_id: string | null;
  billing_terms_id: string | null;
  billing_period_id: string | null;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  value: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!contracts_type_id_fkey(...)` — see
   * `CONTRACT_SELECT` below. Postgres's default FK naming for an unnamed
   * column FK is `<table>_<column>_fkey` (same reasoning
   * `app/(app)/assets/actions.ts`'s `ASSET_SELECT` comment documents). */
  contract_type: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!contracts_sla_tier_id_fkey(...)`.
   * `null` whenever `sla_tier_id` is `null` (no SLA tier set). */
  sla_tier: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!contracts_billing_terms_id_fkey(...)`.
   * `null` whenever `billing_terms_id` is `null`. */
  billing_terms: ResolvedReferenceItem | null;
  /** Embedded via `reference_list_items!contracts_billing_period_id_fkey(...)`.
   * `null` whenever `billing_period_id` is `null`. Independent sibling of
   * `billing_terms` — see `billing_period_id`'s own migration comment
   * (`20260905100000_contracts_billing_period_line_items_and_article_rules.sql`). */
  billing_period: ResolvedReferenceItem | null;
}

/** A contract's line item — an article the Quote generated from this
 * contract should be pre-populated with (issue #122). No purchase_price
 * anywhere on this shape: purchase price is always read live from
 * `articles.purchase_price` by the caller, never snapshotted (see the
 * migration's design note 2). */
export interface ContractLineItemRecord {
  id: string;
  contract_id: string;
  organization_id: string;
  article_id: string;
  article_number: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A contract's include/exclude rule against an Article Group tree node
 * (issue #122). `is_excluded = true` means the group is covered by the
 * contract (excluded from separate invoicing); `false` means explicitly NOT
 * covered (bill it separately). */
export interface ContractArticleGroupRuleRecord {
  id: string;
  contract_id: string;
  organization_id: string;
  article_group_id: string;
  is_excluded: boolean;
  created_by: string | null;
  created_at: string;
}

/** The article-level sibling of `ContractArticleGroupRuleRecord` — same
 * `is_excluded` semantics, against an individual article instead of a
 * group. */
export interface ContractArticleRuleRecord {
  id: string;
  contract_id: string;
  organization_id: string;
  article_id: string;
  is_excluded: boolean;
  created_by: string | null;
  created_at: string;
}

/** A contract's linked asset — `contract_assets` joined out to the asset's
 * own core columns, for the "assets covered by this contract" tab/list.
 * Deliberately a narrower shape than `AssetRecord`
 * (`app/(app)/assets/actions.ts`): just enough to render a list row/link,
 * not the full asset detail (the frontend can call `getAsset(assetId)` for
 * that if a user drills in). */
export interface ContractAssetRecord {
  contract_id: string;
  asset_id: string;
  organization_id: string;
  created_by: string | null;
  created_at: string;
  asset: {
    id: string;
    name: string;
    client_id: string;
    site_id: string;
  } | null;
}

/** Shared select shape for every query returning a `ContractRecord`, so the
 * frontend gets the resolved type/sla_tier/billing_terms value/label/color
 * in one round trip instead of N+1-ing a lookup per row per column — same
 * reasoning as `WORK_ORDER_SELECT` in `app/(app)/work-orders/actions.ts`. */
const CONTRACT_SELECT =
  "*, contract_type:reference_list_items!contracts_type_id_fkey(value,label,color), sla_tier:reference_list_items!contracts_sla_tier_id_fkey(value,label,color), billing_terms:reference_list_items!contracts_billing_terms_id_fkey(value,label,color), billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,color)";

/** Shared select shape for every query returning a `ContractAssetRecord`. */
const CONTRACT_ASSET_SELECT = "*, asset:assets(id, name, client_id, site_id)";

const uuidSchema = z.string().uuid("Invalid id.");

function toContractInsertRow(input: ReturnType<typeof contractCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    name: input.name,
    sla_tier_id: input.slaTierId ?? null,
    billing_terms_id: input.billingTermsId ?? null,
    billing_period_id: input.billingPeriodId ?? null,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    value: input.value ?? null,
    notes: input.notes ?? null,
  };
  // type_id is intentionally omitted (not even sent as null) when not
  // provided — the `derive_contract_organization_id` DB trigger fills in the
  // organization's default `contract_type` item on insert. Same reasoning as
  // `toWorkOrderInsertRow`'s `statusId` omission in
  // app/(app)/work-orders/actions.ts.
  if (input.typeId !== undefined) row.type_id = input.typeId;
  // auto_renew is intentionally omitted when not provided — the column
  // itself defaults to `false` at the DB layer, same "no default supplied"
  // vs. "default to null" distinction `toAssetInsertRow`'s `statusId`
  // comment documents in app/(app)/assets/actions.ts.
  if (input.autoRenew !== undefined) row.auto_renew = input.autoRenew;
  return row;
}

function toContractUpdateRow(input: ReturnType<typeof contractUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.name !== undefined) row.name = input.name;
  if (input.typeId !== undefined) row.type_id = input.typeId;
  if (input.slaTierId !== undefined) row.sla_tier_id = input.slaTierId ?? null;
  if (input.billingTermsId !== undefined) row.billing_terms_id = input.billingTermsId ?? null;
  if (input.billingPeriodId !== undefined) row.billing_period_id = input.billingPeriodId ?? null;
  if (input.startDate !== undefined) row.start_date = input.startDate;
  if (input.endDate !== undefined) row.end_date = input.endDate ?? null;
  if (input.autoRenew !== undefined) row.auto_renew = input.autoRenew;
  if (input.value !== undefined) row.value = input.value ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface ListContractsOptions {
  clientId?: string;
  typeId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lists contracts, org-scoped via RLS automatically. Supports filtering by
 * `clientId` and/or `typeId` (both optional, combinable), same pattern as
 * `listWorkOrders`/`listAssets`.
 *
 * Default order: most-recently created first — there is no "what's next"
 * queue concept for contracts the way there is for work orders.
 */
export async function listContracts(
  options: ListContractsOptions = {},
): Promise<ActionResult<{ contracts: ContractRecord[]; count: number }>> {
  for (const [label, value] of [
    ["client id filter", options.clientId],
    ["type id filter", options.typeId],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) {
      return fail(`Invalid ${label}.`);
    }
  }

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view contracts.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("contracts").select(CONTRACT_SELECT, { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.typeId) query = query.eq("type_id", options.typeId);
  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ contracts: (data ?? []) as ContractRecord[], count: count ?? 0 });
}

export async function getContract(id: string): Promise<ActionResult<{ contract: ContractRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found.");
  return ok({ contract: data as ContractRecord });
}

/** Owner/finance only (per the RBAC matrix + RLS INSERT policy, both agree —
 * planner/engineer/administratie have no `create` action in the matrix at
 * all, so there is no gap to document here the way there is for
 * `assets.update`). */
export async function createContract(input: unknown): Promise<ActionResult<{ contract: ContractRecord }>> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "create")) {
    return fail("Only an owner or finance user can create contracts.");
  }

  const parsed = contractCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contracts")
    .insert(toContractInsertRow(parsed.data))
    .select(CONTRACT_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ contract: data as ContractRecord });
}

/** Owner/finance only (per the RBAC matrix + RLS UPDATE policy, both agree). */
export async function updateContract(
  id: string,
  input: unknown,
): Promise<ActionResult<{ contract: ContractRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "update")) {
    return fail("Only an owner or finance user can update contracts.");
  }

  const parsed = contractUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toContractUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contracts")
    .update(row)
    .eq("id", idResult.data)
    .select(CONTRACT_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found, or you do not have permission to update it.");
  return ok({ contract: data as ContractRecord });
}

/** Owner/finance only (per the RBAC matrix + RLS DELETE policy, both agree).
 * Hard delete. `contract_assets.contract_id` has `on delete cascade` (see
 * the migration), so deleting a contract silently deletes its asset links
 * too; `work_orders.contract_id` is `on delete set null`, so linked work
 * orders survive with `contract_id` cleared rather than being deleted. */
export async function deleteContract(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "delete")) {
    return fail("Only an owner or finance user can delete contracts.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contracts")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

// ---------------------------------------------------------------------------
// Contract assets — the `contract_assets` many-to-many link. Gated on the
// same `contracts` RBAC module/feature as the contract record itself (not a
// separate matrix row), matching the DB's "if you can manage the contract,
// you can manage its asset links" RLS boundary exactly (see the module
// comment above and the migration's design note 4).
// ---------------------------------------------------------------------------

/**
 * The reverse direction of `listContractAssets` below — how many contracts
 * cover a given asset, for that asset's own detail/edit page's "Linked
 * records" rail (asset new/edit design handoff). A plain `count`, not the
 * full `ContractAssetRecord[]` shape `listContractAssets` returns, since the
 * rail only ever needs a number, not a list to render. Same RBAC gate as
 * `listContractAssets` (`read`, any org member) — this is still just reading
 * `contract_assets`, the direction of the join doesn't change who's allowed
 * to see it.
 */
export async function countContractsForAsset(assetId: string): Promise<ActionResult<{ count: number }>> {
  const idResult = uuidSchema.safeParse(assetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this asset's contracts.");
  }

  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("contract_assets")
    .select("contract_id", { count: "exact", head: true })
    .eq("asset_id", idResult.data);

  if (error) return fail(mapDbError(error));
  return ok({ count: count ?? 0 });
}

/** Lists the assets linked to a contract. Readable by anyone who can read
 * contracts at all (`read`), same as `listContracts`/`getContract` — the
 * DB's SELECT policy on `contract_assets` is likewise "any org member", not
 * owner/finance-only (only the writes are restricted). */
export async function listContractAssets(
  contractId: string,
): Promise<ActionResult<{ contractAssets: ContractAssetRecord[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract's assets.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_assets")
    .select(CONTRACT_ASSET_SELECT)
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  return ok({ contractAssets: (data ?? []) as unknown as ContractAssetRecord[] });
}

/** The reverse direction of `listContractAssets` above — every contract
 * linked to a given asset, for that asset's own detail/edit screen's
 * "Contract" relation card (asset new/edit design handoff v3: "show the
 * first linked contract... with a subtitle noting '+N more'"). Same RBAC
 * gate as `listContractAssets`/`countContractsForAsset` (`read`, any org
 * member) — reading the same `contract_assets` join, just walked from the
 * asset side instead of the contract side. Returns full `ContractRecord`s
 * (not the narrower `ContractAssetRecord` shape) since the relation card
 * needs the contract's own type/dates, not just its id/name. */
export async function listContractsForAsset(assetId: string): Promise<ActionResult<{ contracts: ContractRecord[] }>> {
  const idResult = uuidSchema.safeParse(assetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this asset's contracts.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_assets")
    .select(`contract:contracts(${CONTRACT_SELECT})`)
    .eq("asset_id", idResult.data)
    .order("created_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  const contracts = (data ?? [])
    .map((row) => (row as unknown as { contract: ContractRecord | null }).contract)
    .filter((contract): contract is ContractRecord => contract !== null);
  return ok({ contracts });
}

const linkContractAssetSchema = z.object({
  contractId: z.string().uuid("Invalid contract id."),
  assetId: z.string().uuid("Invalid asset id."),
});

/**
 * Links an asset to a contract. Owner/finance only, matching the DB's
 * `contract_assets_insert_owner_or_finance` policy exactly. The asset's own
 * `client_id` must match the contract's `client_id` — enforced by the
 * `validate_contract_asset_relations` DB trigger (not re-validated here; a
 * mismatch surfaces as a clean `mapDbError` `23514` message), same trust
 * boundary this module extends throughout (see the module comment above).
 */
export async function linkContractAsset(
  contractId: string,
  assetId: string,
): Promise<ActionResult<{ contractAsset: ContractAssetRecord }>> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "create")) {
    return fail("Only an owner or finance user can link assets to a contract.");
  }

  const parsed = linkContractAssetSchema.safeParse({ contractId, assetId });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_assets")
    .insert({ contract_id: parsed.data.contractId, asset_id: parsed.data.assetId })
    .select(CONTRACT_ASSET_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ contractAsset: data as unknown as ContractAssetRecord });
}

/**
 * Unlinks an asset from a contract (deletes the `contract_assets` row).
 * Owner/finance only, matching the DB's
 * `contract_assets_delete_owner_or_finance` policy. There is no "update" for
 * this link (see the migration's design note 3) — to change either side,
 * unlink then link again.
 */
export async function unlinkContractAsset(
  contractId: string,
  assetId: string,
): Promise<ActionResult<{ contractId: string; assetId: string }>> {
  const parsed = linkContractAssetSchema.safeParse({ contractId, assetId });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "delete")) {
    return fail("Only an owner or finance user can unlink assets from a contract.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_assets")
    .delete()
    .eq("contract_id", parsed.data.contractId)
    .eq("asset_id", parsed.data.assetId)
    .select("contract_id, asset_id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) {
    return fail("This asset is not linked to the contract, or you do not have permission to unlink it.");
  }
  return ok({ contractId: data.contract_id as string, assetId: data.asset_id as string });
}

// ---------------------------------------------------------------------------
// Contract line items — the `contract_line_items` sub-entity (issue #122):
// articles a Quote generated from this contract should be pre-populated
// with. Gated on the same `contracts` RBAC module as the contract record
// itself (not a separate matrix row), same "if you can manage the contract,
// you can manage its line items" boundary as `contract_assets` above. No
// purchase price anywhere here or in any caller of these actions — always
// read `articles.purchase_price` live, per the migration's design note 2.
// ---------------------------------------------------------------------------

const contractLineItemWriteSchema = z.object({
  articleId: z.string().uuid("Invalid article id."),
  articleNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  quantity: z.coerce.number({ invalid_type_error: "Quantity must be a number." }).finite().optional(),
  unitPrice: z.coerce.number({ invalid_type_error: "Unit price must be a number." }).finite().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Lists a contract's line items, ordered the same way `quote_line_items`
 * lists are (sort_order, then created_at). Readable by anyone who can read
 * contracts at all (`read`), same as `listContractAssets`. */
export async function listContractLineItems(
  contractId: string,
): Promise<ActionResult<{ lineItems: ContractLineItemRecord[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract's line items.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_line_items")
    .select("*")
    .eq("contract_id", idResult.data)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ lineItems: (data ?? []) as ContractLineItemRecord[] });
}

/** Owner/finance only, matching `contract_line_items_insert_owner_or_finance`.
 * `articleId` must belong to the contract's own organization — enforced by
 * `validate_contract_line_item_relations` (not re-validated here, same trust
 * boundary this module extends throughout). */
export async function createContractLineItem(
  contractId: string,
  input: unknown,
): Promise<ActionResult<{ lineItem: ContractLineItemRecord }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "create")) {
    return fail("Only an owner or finance user can add line items to a contract.");
  }

  const parsed = contractLineItemWriteSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {
    contract_id: idResult.data,
    article_id: parsed.data.articleId,
    article_number: parsed.data.articleNumber ?? null,
    description: parsed.data.description ?? null,
  };
  if (parsed.data.quantity !== undefined) row.quantity = parsed.data.quantity;
  if (parsed.data.unitPrice !== undefined) row.unit_price = parsed.data.unitPrice;
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_line_items")
    .insert(row)
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ lineItem: data as ContractLineItemRecord });
}

/** Owner/finance only, matching `contract_line_items_update_owner_or_finance`. */
export async function updateContractLineItem(
  lineItemId: string,
  input: unknown,
): Promise<ActionResult<{ lineItem: ContractLineItemRecord }>> {
  const idResult = uuidSchema.safeParse(lineItemId);
  if (!idResult.success) return fail("Invalid line item id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "update")) {
    return fail("Only an owner or finance user can update a contract line item.");
  }

  const parsed = contractLineItemWriteSchema.partial().safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.articleId !== undefined) row.article_id = parsed.data.articleId;
  if (parsed.data.articleNumber !== undefined) row.article_number = parsed.data.articleNumber ?? null;
  if (parsed.data.description !== undefined) row.description = parsed.data.description ?? null;
  if (parsed.data.quantity !== undefined) row.quantity = parsed.data.quantity;
  if (parsed.data.unitPrice !== undefined) row.unit_price = parsed.data.unitPrice;
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_line_items")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Line item not found, or you do not have permission to update it.");
  return ok({ lineItem: data as ContractLineItemRecord });
}

/** Owner/finance only, matching `contract_line_items_delete_owner_or_finance`. */
export async function deleteContractLineItem(lineItemId: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(lineItemId);
  if (!idResult.success) return fail("Invalid line item id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "delete")) {
    return fail("Only an owner or finance user can delete a contract line item.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_line_items")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Line item not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

// ---------------------------------------------------------------------------
// Contract article group/individual article rules — `contract_article_group_
// rules` and `contract_article_rules` (issue #122): per-contract include/
// exclude marking against the Article Group tree and individual articles.
// Same RBAC/org-scoping boundary as the sections above. `setContract*Rule`
// upserts on the table's own unique constraint (contract_id, article_
// group_id|article_id) so a caller flipping an existing rule's direction
// never has to handle a raw 23505 conflict itself.
// ---------------------------------------------------------------------------

const contractArticleGroupRuleSchema = z.object({
  contractId: z.string().uuid("Invalid contract id."),
  articleGroupId: z.string().uuid("Invalid article group id."),
  isExcluded: z.boolean(),
});

const contractArticleRuleSchema = z.object({
  contractId: z.string().uuid("Invalid contract id."),
  articleId: z.string().uuid("Invalid article id."),
  isExcluded: z.boolean(),
});

/** Lists every article-group rule for a contract. Readable by anyone who can
 * read contracts at all (`read`). */
export async function listContractArticleGroupRules(
  contractId: string,
): Promise<ActionResult<{ rules: ContractArticleGroupRuleRecord[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract's article group rules.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_group_rules")
    .select("*")
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ rules: (data ?? []) as ContractArticleGroupRuleRecord[] });
}

/** Creates or updates (upsert on `contract_id, article_group_id`) this
 * contract's rule for an article group. Owner/finance only, matching
 * `contract_article_group_rules_insert_owner_or_finance`/`..._update_
 * owner_or_finance`. `articleGroupId` must belong to the contract's own
 * organization — enforced by `validate_contract_article_group_rule_
 * relations` (not re-validated here). */
export async function setContractArticleGroupRule(
  input: unknown,
): Promise<ActionResult<{ rule: ContractArticleGroupRuleRecord }>> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "create")) {
    return fail("Only an owner or finance user can set a contract's article group rules.");
  }

  const parsed = contractArticleGroupRuleSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_group_rules")
    .upsert(
      {
        contract_id: parsed.data.contractId,
        article_group_id: parsed.data.articleGroupId,
        is_excluded: parsed.data.isExcluded,
      },
      { onConflict: "contract_id,article_group_id" },
    )
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ rule: data as ContractArticleGroupRuleRecord });
}

/** Removes this contract's rule for an article group entirely (distinct from
 * setting `isExcluded = false`, which keeps an explicit "not covered"
 * rule row — this deletes the row, meaning "no explicit rule at all").
 * Owner/finance only. */
export async function removeContractArticleGroupRule(
  contractId: string,
  articleGroupId: string,
): Promise<ActionResult<{ contractId: string; articleGroupId: string }>> {
  const parsed = z
    .object({ contractId: z.string().uuid("Invalid contract id."), articleGroupId: z.string().uuid("Invalid article group id.") })
    .safeParse({ contractId, articleGroupId });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "delete")) {
    return fail("Only an owner or finance user can remove a contract's article group rule.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_group_rules")
    .delete()
    .eq("contract_id", parsed.data.contractId)
    .eq("article_group_id", parsed.data.articleGroupId)
    .select("contract_id, article_group_id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) {
    return fail("No rule exists for this article group on this contract, or you do not have permission to remove it.");
  }
  return ok({ contractId: data.contract_id as string, articleGroupId: data.article_group_id as string });
}

/** Lists every individual-article rule for a contract. Readable by anyone
 * who can read contracts at all (`read`). */
export async function listContractArticleRules(
  contractId: string,
): Promise<ActionResult<{ rules: ContractArticleRuleRecord[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract's article rules.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_rules")
    .select("*")
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ rules: (data ?? []) as ContractArticleRuleRecord[] });
}

/** The article-level sibling of `setContractArticleGroupRule` — same upsert
 * shape, against `article_id` instead of `article_group_id`. Owner/finance
 * only. */
export async function setContractArticleRule(
  input: unknown,
): Promise<ActionResult<{ rule: ContractArticleRuleRecord }>> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "create")) {
    return fail("Only an owner or finance user can set a contract's article rules.");
  }

  const parsed = contractArticleRuleSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_rules")
    .upsert(
      {
        contract_id: parsed.data.contractId,
        article_id: parsed.data.articleId,
        is_excluded: parsed.data.isExcluded,
      },
      { onConflict: "contract_id,article_id" },
    )
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ rule: data as ContractArticleRuleRecord });
}

/** The article-level sibling of `removeContractArticleGroupRule`. Owner/
 * finance only. */
export async function removeContractArticleRule(
  contractId: string,
  articleId: string,
): Promise<ActionResult<{ contractId: string; articleId: string }>> {
  const parsed = z
    .object({ contractId: z.string().uuid("Invalid contract id."), articleId: z.string().uuid("Invalid article id.") })
    .safeParse({ contractId, articleId });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "delete")) {
    return fail("Only an owner or finance user can remove a contract's article rule.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_article_rules")
    .delete()
    .eq("contract_id", parsed.data.contractId)
    .eq("article_id", parsed.data.articleId)
    .select("contract_id, article_id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) {
    return fail("No rule exists for this article on this contract, or you do not have permission to remove it.");
  }
  return ok({ contractId: data.contract_id as string, articleId: data.article_id as string });
}
