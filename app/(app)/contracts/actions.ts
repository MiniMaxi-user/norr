"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import {
  contractCreateSchema,
  contractStatusSchema,
  contractUpdateSchema,
  resolveSettlementMonth,
  type ContractInvoicingTiming,
  type ContractStatus,
  type CounterSettlementFrequency,
} from "./schema";

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
  /** System-assigned (issue #216), immutable; never sent on insert/update. */
  contract_number: string;
  /** Optional free-text reference (formerly `name`). */
  external_reference: string | null;
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
  /** DB-derived, read-only (issue #209): trigger-computed from start_date,
   * end_date, billing terms interval and `invoiced_period_count`. `null` when
   * fully invoiced / beyond end_date. Never sent on create/update. */
  next_invoice_date: string | null;
  /** Issue #270: draft | active | ended. New contracts start as draft; only
   * active contracts are invoiced and give work order coverage. */
  status: ContractStatus;
  /** Issue #269: in_advance (default) | in_arrears. */
  invoicing_timing: ContractInvoicingTiming;
  /** DB-managed, read-only (issue #209): billing periods already invoiced. */
  invoiced_period_count: number;
  /** Issue #271: with_invoice (default) | monthly | quarterly | annually. */
  counter_settlement_frequency: CounterSettlementFrequency;
  /** 1-12 for quarterly/annually, null otherwise. */
  counter_settlement_month: number | null;
  /** Set while an ending is scheduled (end_date in the future, status still active). */
  end_scheduled_at: string | null;
  /** end_date before the ending was scheduled (restored on cancel). */
  end_date_before_scheduling: string | null;
  /** True when the contract has a final balance: a final settlement quote OR a final
   * ledger row. Filled by getContract/listContracts/createContract/updateContract/
   * setContractStatus (undefined on the asset-coverage lists). */
  has_final_settlement?: boolean;
  /** End of the last settled counter window (ledger), null when nothing is settled.
   * Filled like has_final_settlement. */
  last_settled_end?: string | null;
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
  billing_terms: (ResolvedReferenceItem & { interval_months: number | null }) | null;
  /** Embedded via `reference_list_items!contracts_billing_period_id_fkey(...)`.
   * `null` whenever `billing_period_id` is `null`. Independent sibling of
   * `billing_terms` — see `billing_period_id`'s own migration comment
   * (`20260905100000_contracts_billing_period_line_items_and_article_rules.sql`). */
  billing_period: (ResolvedReferenceItem & { interval_months: number | null }) | null;
}

/** A contract's line item — an article the Quote generated from this
 * contract should be pre-populated with (issue #122). `purchase_price` is a
 * deliberate, table-specific EXCEPTION to this codebase's usual "never
 * snapshot the cost side" convention (`supabase/migrations/
 * 20260909100000_contract_line_items_volume_and_purchase_price.sql`, issue
 * #129): `contract_line_items` alone stores a real, stored,
 * user-overridable `purchase_price` so a multi-year contract's margin on a
 * pre-agreed usage bundle (`is_volume`) reflects the cost true when the deal
 * was struck, not whatever `articles.purchase_price` happens to be today.
 * `quote_line_items`, `work_order_articles`, and `rate_overrides` are
 * UNCHANGED and still read purchase price live from `articles.purchase_price`
 * — do not "fix" this column back to match those three tables. `is_volume`
 * flags a line item as a pre-agreed usage allowance/bundle ("Volume", e.g.
 * "10,000 cups of coffee per year") rather than a plain sale-priced line. */
export interface ContractLineItemRecord {
  id: string;
  contract_id: string;
  organization_id: string;
  article_id: string;
  article_number: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  purchase_price: number;
  is_volume: boolean;
  /** Counter (item of the `volume` reference list) a volume line is settled against (#238). */
  volume_item_id: string | null;
  overage_unit_price: number | null;
  /** Issue #271: credit usage below the included volume at the line's unit price. */
  credit_under_use: boolean;
  /** Counter label, embedded by `listContractLineItems`. */
  volume_item?: { label: string } | null;
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
    serial_number: string | null;
    external_reference: string | null;
    asset_model: { name: string } | null;
    asset_brand: { label: string } | null;
  } | null;
}

/** Shared select shape for every query returning a `ContractRecord`, so the
 * frontend gets the resolved type/sla_tier/billing_terms value/label/color
 * in one round trip instead of N+1-ing a lookup per row per column — same
 * reasoning as `WORK_ORDER_SELECT` in `app/(app)/work-orders/actions.ts`. */
const CONTRACT_SELECT =
  "*, contract_type:reference_list_items!contracts_type_id_fkey(value,label,color), sla_tier:reference_list_items!contracts_sla_tier_id_fkey(value,label,color), billing_terms:reference_list_items!contracts_billing_terms_id_fkey(value,label,color,interval_months), billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,color,interval_months)";

/** Shared select shape for every query returning a `ContractAssetRecord`. */
const CONTRACT_ASSET_SELECT =
  "*, asset:assets(id, name, client_id, site_id, serial_number, external_reference, asset_model:asset_models!assets_model_id_fkey(name), asset_brand:reference_list_items!assets_brand_item_id_fkey(label))";

const uuidSchema = z.string().uuid("Invalid id.");

/** Adds has_final_settlement and last_settled_end (issue #271) to contract records:
 * two bulk queries (final quotes, ledger rows) for all given contracts. */
async function attachFinalBalanceInfo(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  contracts: ContractRecord[],
): Promise<{ contracts: ContractRecord[]; error: string | null }> {
  if (contracts.length === 0) return { contracts, error: null };
  const ids = contracts.map((c) => c.id);
  const [{ data: finalQuotes, error: quotesError }, { data: ledger, error: ledgerError }] = await Promise.all([
    supabase.from("quotes").select("contract_id").eq("is_final_settlement", true).in("contract_id", ids),
    supabase.from("contract_counter_settlements").select("contract_id, period_end, is_final").in("contract_id", ids),
  ]);
  const error = quotesError ?? ledgerError;
  if (error) return { contracts, error: mapDbError(error) };
  const hasFinal = new Set<string>((finalQuotes ?? []).map((r) => r.contract_id as string));
  const lastEnd = new Map<string, string>();
  for (const row of ledger ?? []) {
    const id = row.contract_id as string;
    if (row.is_final) hasFinal.add(id);
    const end = row.period_end as string;
    if (!lastEnd.has(id) || end > (lastEnd.get(id) as string)) lastEnd.set(id, end);
  }
  return {
    contracts: contracts.map((c) => ({
      ...c,
      has_final_settlement: hasFinal.has(c.id),
      last_settled_end: lastEnd.get(c.id) ?? null,
    })),
    error: null,
  };
}

function toContractInsertRow(input: ReturnType<typeof contractCreateSchema.parse>) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    external_reference: input.externalReference ?? null,
    sla_tier_id: input.slaTierId ?? null,
    billing_terms_id: input.billingTermsId ?? null,
    billing_period_id: input.billingPeriodId ?? null,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    value: input.value ?? null,
    notes: input.notes ?? null,
    // Issue #270: always start as draft (the column default; stated explicitly
    // so a client can never insert a contract as active).
    status: "draft",
  };
  if (input.invoicingTiming !== undefined) row.invoicing_timing = input.invoicingTiming;
  const frequency = input.counterSettlementFrequency ?? "with_invoice";
  row.counter_settlement_frequency = frequency;
  row.counter_settlement_month = resolveSettlementMonth(frequency, input.counterSettlementMonth, input.startDate);
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
  if (input.externalReference !== undefined) row.external_reference = input.externalReference;
  if (input.typeId !== undefined) row.type_id = input.typeId;
  if (input.slaTierId !== undefined) row.sla_tier_id = input.slaTierId ?? null;
  if (input.billingTermsId !== undefined) row.billing_terms_id = input.billingTermsId ?? null;
  if (input.billingPeriodId !== undefined) row.billing_period_id = input.billingPeriodId ?? null;
  if (input.startDate !== undefined) row.start_date = input.startDate;
  if (input.endDate !== undefined) row.end_date = input.endDate ?? null;
  if (input.autoRenew !== undefined) row.auto_renew = input.autoRenew;
  if (input.value !== undefined) row.value = input.value ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  if (input.invoicingTiming !== undefined) row.invoicing_timing = input.invoicingTiming;
  // counter_settlement_frequency / _month are resolved by updateContract (needs the current row).
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
  /**
   * List-page filters (web design system list shell). All optional; every
   * other caller passes none and is unaffected.
   *
   * `search` matches contract number, external reference, client name and the
   * type / SLA tier / billing terms labels.
   */
  search?: string;
  slaTierId?: string;
  /** Derived lifecycle (see `contract-status.ts`): `active` = started and not
   * ended, `upcoming` = starts in the future, `ended` = end date in the past. */
  phase?: "active" | "upcoming" | "ended";
  /** Contract status (issue #270). Pickers that must only offer contracts that
   * give coverage (work orders, activities) pass `"active"`. */
  status?: ContractStatus | ContractStatus[];
  /** Sort column; unknown values fall back to newest-created first. */
  sort?: "contract_number" | "start_date" | "end_date" | "next_invoice_date" | "value";
  direction?: "asc" | "desc";
  /** Also return `unfilteredCount` (every contract, ignoring all filters) for
   * the "3 of 12" count. Only the list page asks for it. */
  includeUnfilteredCount?: boolean;
}

const CONTRACT_SORT_COLUMNS = new Set(["contract_number", "start_date", "end_date", "next_invoice_date", "value"]);

/** Strips characters that would break a PostgREST `or()`/`ilike` pattern. */
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()%*\\"':]/g, " ").replace(/ +/g, " ").trim().slice(0, 80);
}

/**
 * Lists contracts, org-scoped via RLS automatically. Supports filtering by
 * `clientId` and/or `typeId` (both optional, combinable), same pattern as
 * `listWorkOrders`/`listAssets`; the list page adds search, SLA tier,
 * lifecycle phase and sorting (see `ListContractsOptions`).
 *
 * Default order: most-recently created first — there is no "what's next"
 * queue concept for contracts the way there is for work orders.
 */
export async function listContracts(
  options: ListContractsOptions = {},
): Promise<ActionResult<{ contracts: ContractRecord[]; count: number; unfilteredCount?: number }>> {
  for (const [label, value] of [
    ["client id filter", options.clientId],
    ["type id filter", options.typeId],
    ["SLA tier filter", options.slaTierId],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) {
      return fail(`Invalid ${label}.`);
    }
  }

  const statusFilter =
    options.status === undefined
      ? undefined
      : z.array(contractStatusSchema).min(1).safeParse(Array.isArray(options.status) ? options.status : [options.status]);
  if (statusFilter && !statusFilter.success) return fail("Invalid status filter.");

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
  if (options.slaTierId) query = query.eq("sla_tier_id", options.slaTierId);
  if (statusFilter?.success) query = query.in("status", statusFilter.data);

  const term = sanitizeSearchTerm(options.search ?? "");
  if (term) {
    // Client / type / SLA tier / billing terms live in other tables: resolve
    // their matches first and fold the ids into the same `or()`.
    const [clientMatches, itemMatches] = await Promise.all([
      supabase.from("clients").select("id").ilike("name", `%${term}%`).limit(100),
      supabase.from("reference_list_items").select("id").ilike("label", `%${term}%`).limit(100),
    ]);
    const ids = (rows: { id: string }[] | null) => (rows ?? []).map((row) => row.id);
    const clientIds = ids(clientMatches.data);
    const itemIds = ids(itemMatches.data);
    query = query.or(
      [
        `contract_number.ilike.%${term}%`,
        `external_reference.ilike.%${term}%`,
        ...(clientIds.length > 0 ? [`client_id.in.(${clientIds.join(",")})`] : []),
        ...(itemIds.length > 0
          ? [
              `type_id.in.(${itemIds.join(",")})`,
              `sla_tier_id.in.(${itemIds.join(",")})`,
              `billing_terms_id.in.(${itemIds.join(",")})`,
            ]
          : []),
      ].join(","),
    );
  }

  if (options.phase) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
    if (options.phase === "upcoming") {
      query = query.gt("start_date", today);
    } else if (options.phase === "ended") {
      query = query.lt("end_date", today);
    } else {
      query = query.lte("start_date", today).or(`end_date.is.null,end_date.gte.${today}`);
    }
  }

  if (options.sort && CONTRACT_SORT_COLUMNS.has(options.sort)) {
    query = query.order(options.sort, { ascending: options.direction !== "desc", nullsFirst: false });
    if (options.sort !== "contract_number") query = query.order("contract_number", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }
  query = query.range(offset, offset + limit - 1);

  const [{ data, error, count }, unfiltered] = await Promise.all([
    query,
    options.includeUnfilteredCount
      ? supabase.from("contracts").select("id", { count: "exact", head: true })
      : Promise.resolve(null),
  ]);
  if (error) return fail(mapDbError(error));
  const listed = await attachFinalBalanceInfo(supabase, (data ?? []) as ContractRecord[]);
  if (listed.error) return fail(listed.error);
  return ok({
    contracts: listed.contracts,
    count: count ?? 0,
    ...(unfiltered ? { unfilteredCount: unfiltered.count ?? 0 } : {}),
  });
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
  const attached = await attachFinalBalanceInfo(supabase, [data as ContractRecord]);
  if (attached.error) return fail(attached.error);
  return ok({ contract: attached.contracts[0] as ContractRecord });
}

const PERIODIC_NEEDS_RECURRING = "Periodic counter settlement requires recurring billing terms";

/** True when the billing terms item has an interval (recurring). */
async function billingTermsRecurring(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billingTermsId: string | null | undefined,
): Promise<{ recurring: boolean } | { error: string }> {
  if (!billingTermsId) return { recurring: false };
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("interval_months")
    .eq("id", billingTermsId)
    .maybeSingle<{ interval_months: number | null }>();
  if (error) return { error: mapDbError(error) };
  return { recurring: Boolean(data?.interval_months) };
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
  if ((parsed.data.counterSettlementFrequency ?? "with_invoice") !== "with_invoice") {
    const terms = await billingTermsRecurring(supabase, parsed.data.billingTermsId);
    if ("error" in terms) return fail(terms.error);
    if (!terms.recurring) {
      return fail(PERIODIC_NEEDS_RECURRING, { counterSettlementFrequency: [PERIODIC_NEEDS_RECURRING] });
    }
  }
  const { data, error } = await supabase
    .from("contracts")
    .insert(toContractInsertRow(parsed.data))
    .select(CONTRACT_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ contract: { ...(data as ContractRecord), has_final_settlement: false, last_settled_end: null } });
}

/** A counter reading still required before a contract can be activated, or
 * (for a newly linked asset) before it counts in settlement (issues #269/#270). */
export interface MissingBaselineReading {
  assetId: string;
  assetName: string;
  volumeItemId: string;
  counterLabel: string;
}

function toMissingBaseline(rows: unknown): MissingBaselineReading[] {
  return ((rows ?? []) as { asset_id: string; asset_name: string; volume_item_id: string; counter_label: string }[]).map(
    (row) => ({
      assetId: row.asset_id,
      assetName: row.asset_name,
      volumeItemId: row.volume_item_id,
      counterLabel: row.counter_label,
    }),
  );
}

function describeMissingBaseline(missing: readonly MissingBaselineReading[]): string {
  return missing.map((m) => `${m.assetName} – ${m.counterLabel}`).join(", ");
}

/**
 * Issue #270: the covered assets / counters that still have no accepted reading
 * on or before the contract start date (empty = the contract can be activated).
 * Same RBAC gate as `getContract` (`read`). Backed by the
 * `contract_missing_baseline_readings` SQL function (security invoker).
 */
export async function getContractBaselineStatus(
  contractId: string,
): Promise<ActionResult<{ missing: MissingBaselineReading[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("contract_missing_baseline_readings", {
    p_contract_id: idResult.data,
  });
  if (error) return fail(mapDbError(error));
  return ok({ missing: toMissingBaseline(data) });
}

/** Allowed manual transitions (issue #270/#271): Draft -> Active and Ended -> Active
 * (the DB refuses that one after the end date or once a final settlement exists).
 * Ending goes through the end page / completeContractEnd (contracts/end-actions.ts). */
const CONTRACT_STATUS_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ["active"],
  active: [],
  ended: ["active"],
};

export interface SetContractStatusResult {
  /** False when activation was refused because of missing baseline readings. */
  changed: boolean;
  contract: ContractRecord | null;
  /** Filled when `changed` is false because baseline readings are missing. */
  missingBaseline: MissingBaselineReading[];
  /** Human-readable reason when `changed` is false. */
  message: string | null;
}

/**
 * Changes a contract's status (issue #270). Owner/finance only (`update`, same
 * as updateContract). Activating is guarded by the DB trigger
 * `contracts_guard_status_change`: a 23514 "Missing baseline readings" is
 * mapped to a clean `changed: false` result with the structured list (re-read
 * through the RPC); any other refusal (e.g. reactivating after the end date)
 * is returned as an error with the DB's message.
 *
 * Issue #271: 'ended' is no longer accepted here. Ending a contract (final balance,
 * closing readings, scheduled ending) goes through contracts/end-actions.ts.
 */
export async function setContractStatus(
  contractId: string,
  status: unknown,
): Promise<ActionResult<SetContractStatusResult>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "contracts", "update")) {
    return fail("Only an owner or finance user can change a contract's status.");
  }

  const statusResult = contractStatusSchema.safeParse(status);
  if (!statusResult.success) return fail("Invalid contract status.");
  const target = statusResult.data;
  if (target === "ended") {
    return fail("Use the End contract page to end a contract (final balance).");
  }

  const supabase = await createSupabaseServerClient();
  const { data: current, error: currentError } = await supabase
    .from("contracts")
    .select("status")
    .eq("id", idResult.data)
    .maybeSingle<{ status: ContractStatus }>();
  if (currentError) return fail(mapDbError(currentError));
  if (!current) return fail("Contract not found.");
  if (current.status === target) return fail(`The contract is already ${target}.`);
  if (!CONTRACT_STATUS_TRANSITIONS[current.status].includes(target)) {
    return fail(`A ${current.status} contract cannot be set to ${target}.`);
  }

  const patch: { status: ContractStatus } = { status: target };

  const { data, error } = await supabase
    .from("contracts")
    .update(patch)
    .eq("id", idResult.data)
    .eq("status", current.status)
    .select(CONTRACT_SELECT)
    .maybeSingle();

  if (error) {
    if (error.code === "23514" && error.message.startsWith("Missing baseline readings")) {
      const { data: rows } = await supabase.rpc("contract_missing_baseline_readings", {
        p_contract_id: idResult.data,
      });
      const missing = toMissingBaseline(rows);
      return ok({
        changed: false,
        contract: null,
        missingBaseline: missing,
        message: missing.length > 0 ? `Missing baseline readings: ${describeMissingBaseline(missing)}` : error.message,
      });
    }
    if (error.code === "23514" && error.message.startsWith("An ended contract")) {
      return fail(error.message);
    }
    return fail(mapDbError(error));
  }
  if (!data) return fail("Contract not found, its status changed in the meantime, or you do not have permission to update it.");
  const attached = await attachFinalBalanceInfo(supabase, [data as ContractRecord]);
  return ok({
    changed: true,
    contract: attached.contracts[0] ?? (data as ContractRecord),
    missingBaseline: [],
    message: null,
  });
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
  // The counter settlement fields are resolved below (against the current row),
  // so they count as changes even though toContractUpdateRow leaves them out.
  const settlementChanged =
    parsed.data.counterSettlementFrequency !== undefined || parsed.data.counterSettlementMonth !== undefined;
  if (Object.keys(row).length === 0 && !settlementChanged) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();

  // Switching invoicing timing after a period is invoiced would skip a period's
  // counter settlement (in advance -> in arrears loses the previous period).
  if (row.invoicing_timing !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("contracts")
      .select("invoicing_timing, invoiced_period_count")
      .eq("id", idResult.data)
      .maybeSingle<{ invoicing_timing: string; invoiced_period_count: number }>();
    if (currentError) return fail(mapDbError(currentError));
    if (current && current.invoicing_timing !== row.invoicing_timing && current.invoiced_period_count > 0) {
      return fail("Invoicing can't be changed once a period has been invoiced.", {
        invoicingTiming: ["Invoicing can't be changed once a period has been invoiced."],
      });
    }
  }

  // Counter settlement frequency/month (issue #271): the month depends on the
  // frequency and the start date, so resolve it against the current row.
  if (
    parsed.data.counterSettlementFrequency !== undefined ||
    parsed.data.counterSettlementMonth !== undefined ||
    parsed.data.billingTermsId !== undefined ||
    parsed.data.startDate !== undefined
  ) {
    const { data: current, error: currentError } = await supabase
      .from("contracts")
      .select("start_date, billing_terms_id, counter_settlement_frequency, counter_settlement_month")
      .eq("id", idResult.data)
      .maybeSingle<{
        start_date: string;
        billing_terms_id: string | null;
        counter_settlement_frequency: CounterSettlementFrequency;
        counter_settlement_month: number | null;
      }>();
    if (currentError) return fail(mapDbError(currentError));
    if (!current) return fail("Contract not found, or you do not have permission to update it.");
    const frequency = parsed.data.counterSettlementFrequency ?? current.counter_settlement_frequency;
    const startDate = parsed.data.startDate ?? current.start_date;
    if (frequency !== "with_invoice") {
      const terms = await billingTermsRecurring(supabase, parsed.data.billingTermsId ?? current.billing_terms_id);
      if ("error" in terms) return fail(terms.error);
      if (!terms.recurring) {
        return fail(PERIODIC_NEEDS_RECURRING, { counterSettlementFrequency: [PERIODIC_NEEDS_RECURRING] });
      }
    }
    // Keep the stored month while the frequency stays calendar-based and no new month is given.
    const keptMonth =
      parsed.data.counterSettlementFrequency === undefined || parsed.data.counterSettlementFrequency === current.counter_settlement_frequency
        ? current.counter_settlement_month
        : null;
    row.counter_settlement_frequency = frequency;
    row.counter_settlement_month = resolveSettlementMonth(
      frequency,
      parsed.data.counterSettlementMonth ?? keptMonth,
      startDate,
    );
  }

  const { data, error } = await supabase
    .from("contracts")
    .update(row)
    .eq("id", idResult.data)
    .select(CONTRACT_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found, or you do not have permission to update it.");
  const attached = await attachFinalBalanceInfo(supabase, [data as ContractRecord]);
  return ok({ contract: attached.contracts[0] ?? (data as ContractRecord) });
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
    .select("contract_id, contract:contracts!inner(status)", { count: "exact", head: true })
    .eq("asset_id", idResult.data)
    .eq("contract.status", "active");

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
    .select(`contract:contracts!inner(${CONTRACT_SELECT})`)
    .eq("asset_id", idResult.data)
    .eq("contract.status", "active")
    .order("created_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  const contracts = (data ?? [])
    .map((row) => (row as unknown as { contract: ContractRecord | null }).contract)
    .filter((contract): contract is ContractRecord => contract !== null);
  return ok({ contracts });
}

/**
 * A single contract that covers an asset, tagged with WHY it covers it —
 * either a direct `contract_assets` link on the asset itself, or inherited
 * from an ancestor in the asset's `asset_components` composition chain (issue
 * #126 product-owner rule: a contract linked to a composite "main" asset also
 * covers every sub-asset in that asset's tree). A discriminated union on
 * `type` (rather than the issue's sketched `"direct" | { inheritedFrom }`
 * shape) so a `switch`/narrowing on `source.type` is exhaustive and
 * `viaAsset` is only ever reachable once `type` is confirmed `"inherited"`.
 */
export type AssetContractCoverageSource =
  | { type: "direct" }
  | { type: "inherited"; viaAsset: { id: string; name: string } };

export interface AssetContractCoverage {
  contract: ContractRecord;
  source: AssetContractCoverageSource;
}

/**
 * The full set of contracts that cover `assetId`, direct AND inherited —
 * supersedes `listContractsForAsset` for any caller that needs to render the
 * "via <parent asset>" distinction (the Assets Contract card's follow-up).
 * `listContractsForAsset` itself is left untouched (still direct-only) since
 * nothing outside this file's own module needs to change its existing
 * behavior.
 *
 * Two parts:
 *  1. Direct: contracts linked to `assetId` itself via `contract_assets`
 *     (identical query to `listContractsForAsset`).
 *  2. Inherited: walk UP the `asset_components` chain from `assetId` — at
 *     most one hop matches per level (`component_asset_id` is unique across
 *     the whole table, see `getAssetCompositionTree`'s own up-walk in
 *     `app/(app)/assets/components-actions.ts`, mirrored here rather than
 *     re-derived differently), depth-capped defensively at 100 — then fetch
 *     every contract directly linked to any ancestor found along that chain.
 *
 * Dedupe: a contract directly linked to `assetId` AND (unusually) also linked
 * to one of its ancestors is only returned once, as `"direct"` (the more
 * specific/authoritative link) — never duplicated as both. Among purely
 * inherited contracts, if the same contract is somehow linked to more than
 * one ancestor in the chain (also unusual — remember the chain is a single
 * linear walk, so this only happens if an owner links the same contract to
 * two different ancestors), the CLOSEST ancestor wins for the `viaAsset`
 * subtitle (ancestors are walked nearest-to-farthest, first-seen-wins).
 *
 * Same RBAC gate as `listContractsForAsset`/`countContractsForAsset`
 * (`canAny(actor, "contracts", ["read"])`, any org member) — this only reads
 * `contract_assets` and `asset_components`, both already readable by any org
 * member per their own RLS (`asset_components_select_member`), so no new
 * permission surface. Ordinary RLS-scoped client throughout, never
 * service-role.
 */
export async function listAssetContractCoverage(
  assetId: string,
): Promise<ActionResult<{ coverage: AssetContractCoverage[] }>> {
  const idResult = uuidSchema.safeParse(assetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this asset's contracts.");
  }

  const supabase = await createSupabaseServerClient();

  // Direct: identical query to `listContractsForAsset`.
  const { data: directRows, error: directError } = await supabase
    .from("contract_assets")
    .select(`contract:contracts!inner(${CONTRACT_SELECT})`)
    .eq("asset_id", idResult.data)
    .eq("contract.status", "active")
    .order("created_at", { ascending: false });
  if (directError) return fail(mapDbError(directError));

  const coverage: AssetContractCoverage[] = [];
  const seenContractIds = new Set<string>();
  for (const row of directRows ?? []) {
    const contract = (row as unknown as { contract: ContractRecord | null }).contract;
    if (!contract || seenContractIds.has(contract.id)) continue;
    seenContractIds.add(contract.id);
    coverage.push({ contract, source: { type: "direct" } });
  }

  // Walk UP the composition chain to find every ancestor, nearest first.
  // Single linear chain (`asset_components.component_asset_id` is unique) —
  // never a fan-out — same depth cap as `getAssetCompositionTree`.
  const ancestorIds: string[] = [];
  let current = idResult.data;
  for (let depth = 0; depth < 100; depth++) {
    const { data: parentLink, error: parentError } = await supabase
      .from("asset_components")
      .select("parent_asset_id")
      .eq("component_asset_id", current)
      .maybeSingle();
    if (parentError) return fail(mapDbError(parentError));
    if (!parentLink) break;
    const parentId = parentLink.parent_asset_id as string;
    ancestorIds.push(parentId);
    current = parentId;
  }

  if (ancestorIds.length === 0) {
    return ok({ coverage });
  }

  const [{ data: ancestorAssets, error: ancestorAssetsError }, { data: ancestorLinkRows, error: ancestorLinksError }] =
    await Promise.all([
      supabase.from("assets").select("id,name").in("id", ancestorIds),
      supabase
        .from("contract_assets")
        .select(`asset_id, contract:contracts!inner(${CONTRACT_SELECT})`)
        .in("asset_id", ancestorIds)
        .eq("contract.status", "active")
        .order("created_at", { ascending: false }),
    ]);
  if (ancestorAssetsError) return fail(mapDbError(ancestorAssetsError));
  if (ancestorLinksError) return fail(mapDbError(ancestorLinksError));

  const ancestorNameById = new Map<string, string>();
  for (const asset of ancestorAssets ?? []) {
    ancestorNameById.set(asset.id as string, asset.name as string);
  }

  const linksByAncestorId = new Map<string, { contract: ContractRecord | null }[]>();
  for (const row of ancestorLinkRows ?? []) {
    const typedRow = row as unknown as { asset_id: string; contract: ContractRecord | null };
    const list = linksByAncestorId.get(typedRow.asset_id);
    if (list) list.push(typedRow);
    else linksByAncestorId.set(typedRow.asset_id, [typedRow]);
  }

  // Nearest ancestor first, so a contract linked to more than one ancestor
  // (unusual) resolves its `viaAsset` to the closest one, first-seen-wins.
  for (const ancestorId of ancestorIds) {
    const links = linksByAncestorId.get(ancestorId) ?? [];
    const ancestorName = ancestorNameById.get(ancestorId);
    if (!ancestorName) continue; // ancestor asset not found/readable — skip defensively
    for (const link of links) {
      const contract = link.contract;
      if (!contract || seenContractIds.has(contract.id)) continue;
      seenContractIds.add(contract.id);
      coverage.push({
        contract,
        source: { type: "inherited", viaAsset: { id: ancestorId, name: ancestorName } },
      });
    }
  }

  return ok({ coverage });
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
): Promise<
  ActionResult<{
    contractAsset: ContractAssetRecord;
    /** Issue #270: set when the contract is active and the asset (or one of its
     * components) has no reading on or before today for a counter of the
     * contract; it is not counted in settlement until it has one. */
    warning: string | null;
    missingBaseline: MissingBaselineReading[];
  }>
> {
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

  // Active contract: the asset's baseline date is today (added_on), so it needs
  // a reading on or before today for every counter of the contract.
  let warning: string | null = null;
  let missingBaseline: MissingBaselineReading[] = [];
  const { data: contractRow } = await supabase
    .from("contracts")
    .select("status")
    .eq("id", parsed.data.contractId)
    .maybeSingle<{ status: ContractStatus }>();
  if (contractRow?.status === "active") {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: missingRows }, { data: coveredRows }] = await Promise.all([
      supabase.rpc("contract_missing_baseline_readings_at", {
        p_contract_id: parsed.data.contractId,
        p_start_date: today,
      }),
      supabase.rpc("contract_covered_assets", { p_contract_id: parsed.data.contractId }),
    ]);
    const addedTree = new Set(
      ((coveredRows ?? []) as { asset_id: string; root_asset_id: string }[])
        .filter((row) => row.root_asset_id === parsed.data.assetId)
        .map((row) => row.asset_id),
    );
    missingBaseline = toMissingBaseline(missingRows).filter((m) => addedTree.has(m.assetId));
    if (missingBaseline.length > 0) {
      warning = `Missing readings on or before today: ${describeMissingBaseline(missingBaseline)}. These are not counted in counter settlement until a reading exists.`;
    }
  }

  return ok({ contractAsset: data as unknown as ContractAssetRecord, warning, missingBaseline });
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
// you can manage its line items" boundary as `contract_assets` above.
// `purchase_price`/`is_volume` (issue #129,
// `20260909100000_contract_line_items_volume_and_purchase_price.sql`) are a
// deliberate, table-specific EXCEPTION to this codebase's usual "never
// snapshot the cost side" convention — see `ContractLineItemRecord`'s doc
// comment above for the full reasoning. `quote_line_items`,
// `work_order_articles`, and `rate_overrides` are unchanged and still read
// purchase price live from `articles.purchase_price`.
// ---------------------------------------------------------------------------

const contractLineItemWriteSchema = z.object({
  articleId: z.string().uuid("Invalid article id."),
  articleNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  quantity: z.coerce.number({ invalid_type_error: "Quantity must be a number." }).finite().optional(),
  unitPrice: z.coerce.number({ invalid_type_error: "Unit price must be a number." }).finite().optional(),
  purchasePrice: z.coerce.number({ invalid_type_error: "Purchase price must be a number." }).finite().optional(),
  isVolume: z.boolean().optional(),
  volumeItemId: z.string().uuid("Invalid counter id.").nullish(),
  overageUnitPrice: z.coerce.number({ invalid_type_error: "Overage price must be a number." }).finite().min(0, "Overage price must be 0 or more.").nullish(),
  creditUnderUse: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** Counter columns (#238) only exist on volume lines: the DB check
 * `contract_line_items_counter_requires_volume` rejects them otherwise, so
 * switching `isVolume` off explicitly nulls both. The line quantity is the
 * included counter quantity per billing period. */
function applyCounterColumns(
  row: Record<string, unknown>,
  data: { isVolume?: boolean; volumeItemId?: string | null; overageUnitPrice?: number | null; creditUnderUse?: boolean },
) {
  if (data.isVolume === false) {
    row.volume_item_id = null;
    row.overage_unit_price = null;
    row.credit_under_use = false;
    return;
  }
  if (data.volumeItemId !== undefined) row.volume_item_id = data.volumeItemId;
  if (data.overageUnitPrice !== undefined) row.overage_unit_price = data.overageUnitPrice;
  // Credit under-use only exists for a volume line with a counter (DB check): forced
  // off when the counter is cleared.
  if (data.volumeItemId === null) row.credit_under_use = false;
  else if (data.creditUnderUse !== undefined) row.credit_under_use = data.creditUnderUse;
}

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
  // Explicit column projection (issue #149) — `ContractLineItemsSection` (the
  // only consumer) reads `id`/`article_id`/`article_number`/`description`/
  // `quantity`/`unit_price`/`purchase_price`/`is_volume`; `contract_id`/
  // `organization_id`/`sort_order` (ordering only, never displayed)/
  // `created_by`/`created_at`/`updated_at` are never read back from this
  // list.
  const { data, error } = await supabase
    .from("contract_line_items")
    .select(
      "id, article_id, article_number, description, quantity, unit_price, purchase_price, is_volume, volume_item_id, overage_unit_price, credit_under_use, volume_item:reference_list_items!contract_line_items_volume_item_id_fkey(label)",
    )
    .eq("contract_id", idResult.data)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ lineItems: (data ?? []) as unknown as ContractLineItemRecord[] });
}

/** A counter that occurs on at least one covered asset (#238). */
export interface ContractCounterOption {
  id: string;
  label: string;
  /** Unit label (parent item of the counter), when the counter has one. */
  unit: string | null;
}

/**
 * Counters offered for a contract's volume lines: the `asset_model_volumes`
 * of the asset models of every asset linked via `contract_assets`, INCLUDING
 * the sub-assets of those assets (same inheritance rule as
 * `listAssetContractCoverage`, walked downward through `asset_components`,
 * depth-capped at 100 levels).
 */
export async function listContractCounterOptions(
  contractId: string,
): Promise<ActionResult<{ counters: ContractCounterOption[] }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract's counters.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: links, error: linksError } = await supabase
    .from("contract_assets")
    .select("asset_id")
    .eq("contract_id", idResult.data);
  if (linksError) return fail(mapDbError(linksError));

  const covered = new Set<string>((links ?? []).map((l) => l.asset_id as string));
  let frontier = Array.from(covered);
  for (let depth = 0; depth < 100 && frontier.length > 0; depth++) {
    const { data: children, error: childError } = await supabase
      .from("asset_components")
      .select("component_asset_id")
      .in("parent_asset_id", frontier);
    if (childError) return fail(mapDbError(childError));
    frontier = [];
    for (const child of children ?? []) {
      const childId = child.component_asset_id as string;
      if (!covered.has(childId)) {
        covered.add(childId);
        frontier.push(childId);
      }
    }
  }
  if (covered.size === 0) return ok({ counters: [] });

  const { data: assetRows, error: assetError } = await supabase
    .from("assets")
    .select("model_id")
    .in("id", Array.from(covered));
  if (assetError) return fail(mapDbError(assetError));
  const modelIds = Array.from(
    new Set((assetRows ?? []).map((a) => a.model_id as string | null).filter((m): m is string => !!m)),
  );
  if (modelIds.length === 0) return ok({ counters: [] });

  const { data: modelCounters, error: countersError } = await supabase
    .from("asset_model_volumes")
    .select("volume_item_id")
    .in("asset_model_id", modelIds);
  if (countersError) return fail(mapDbError(countersError));
  const counterIds = Array.from(new Set((modelCounters ?? []).map((c) => c.volume_item_id as string)));
  if (counterIds.length === 0) return ok({ counters: [] });

  const { data: items, error: itemsError } = await supabase
    .from("reference_list_items")
    .select("id, label, parent_item_id")
    .in("id", counterIds);
  if (itemsError) return fail(mapDbError(itemsError));
  const parentIds = Array.from(
    new Set((items ?? []).map((i) => i.parent_item_id as string | null).filter((p): p is string => !!p)),
  );
  const unitById = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: units } = await supabase.from("reference_list_items").select("id, label").in("id", parentIds);
    for (const u of units ?? []) unitById.set(u.id as string, u.label as string);
  }
  const counters = (items ?? [])
    .map((i) => ({
      id: i.id as string,
      label: i.label as string,
      unit: i.parent_item_id ? (unitById.get(i.parent_item_id as string) ?? null) : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return ok({ counters });
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
  if (parsed.data.purchasePrice !== undefined) row.purchase_price = parsed.data.purchasePrice;
  if (parsed.data.isVolume !== undefined) row.is_volume = parsed.data.isVolume;
  applyCounterColumns(row, parsed.data);
  if (!parsed.data.volumeItemId || parsed.data.isVolume === false) row.credit_under_use = false;
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
  if (parsed.data.purchasePrice !== undefined) row.purchase_price = parsed.data.purchasePrice;
  if (parsed.data.isVolume !== undefined) row.is_volume = parsed.data.isVolume;
  applyCounterColumns(row, parsed.data);
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
  // Explicit column projection (issue #149) — `ContractArticleCoverageSection`
  // (the only consumer) reads `id`/`article_group_id`/`is_excluded`;
  // `contract_id`/`organization_id`/`created_by`/`created_at` are never read
  // back from this list.
  const { data, error } = await supabase
    .from("contract_article_group_rules")
    .select("id, article_group_id, is_excluded")
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ rules: (data ?? []) as ContractArticleGroupRuleRecord[] });
}

/** Creates or updates (on `contract_id, article_group_id`) this contract's
 * rule for an article group. Owner/finance only, matching
 * `contract_article_group_rules_insert_owner_or_finance`/`..._update_
 * owner_or_finance`. `articleGroupId` must belong to the contract's own
 * organization — enforced by `validate_contract_article_group_rule_
 * relations` (not re-validated here).
 *
 * Deliberately an explicit lookup + insert-or-update, not a single
 * `.upsert()`: the table's column grants only permit UPDATE on `is_excluded`
 * (`contract_id`/`article_group_id` are an immutable pairing — delete +
 * re-insert to change either side), but `.upsert(...)`'s generated
 * `INSERT ... ON CONFLICT DO UPDATE SET` names every column passed in,
 * including those two — and Postgres checks column privileges against that
 * full SET list at plan time, so it fails with `42501` even on a fresh
 * insert that never actually hits the conflict path. */
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
  const { data: existing, error: lookupError } = await supabase
    .from("contract_article_group_rules")
    .select("id")
    .eq("contract_id", parsed.data.contractId)
    .eq("article_group_id", parsed.data.articleGroupId)
    .maybeSingle();
  if (lookupError) return fail(mapDbError(lookupError));

  const { data, error } = existing
    ? await supabase
        .from("contract_article_group_rules")
        .update({ is_excluded: parsed.data.isExcluded })
        .eq("id", existing.id)
        .select("*")
        .single()
    : await supabase
        .from("contract_article_group_rules")
        .insert({
          contract_id: parsed.data.contractId,
          article_group_id: parsed.data.articleGroupId,
          is_excluded: parsed.data.isExcluded,
        })
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
  // Explicit column projection (issue #149) — same reasoning as
  // `listContractArticleGroupRules` above, against `article_id` instead of
  // `article_group_id`.
  const { data, error } = await supabase
    .from("contract_article_rules")
    .select("id, article_id, is_excluded")
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ rules: (data ?? []) as ContractArticleRuleRecord[] });
}

/** The article-level sibling of `setContractArticleGroupRule` — same
 * lookup + insert-or-update shape (see that function's own doc comment for
 * why this isn't a plain `.upsert()`), against `article_id` instead of
 * `article_group_id`. Owner/finance only. */
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
  const { data: existing, error: lookupError } = await supabase
    .from("contract_article_rules")
    .select("id")
    .eq("contract_id", parsed.data.contractId)
    .eq("article_id", parsed.data.articleId)
    .maybeSingle();
  if (lookupError) return fail(mapDbError(lookupError));

  const { data, error } = existing
    ? await supabase
        .from("contract_article_rules")
        .update({ is_excluded: parsed.data.isExcluded })
        .eq("id", existing.id)
        .select("*")
        .single()
    : await supabase
        .from("contract_article_rules")
        .insert({
          contract_id: parsed.data.contractId,
          article_id: parsed.data.articleId,
          is_excluded: parsed.data.isExcluded,
        })
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
