"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import {
  computeCounterUsage,
  computeOverage,
  contractPeriodByIndex,
  describeOverage,
  isPeriodQuoteDue,
  planSettlementPeriod,
  type CounterAsset,
  type CounterReading,
} from "./counter-settlement";
import {
  addDaysIso,
  billingMultiplier,
  billingPeriodMonths,
  computeContractPeriod,
  describeContractAssets,
  formatPeriodLabel,
  scaleContractLine,
  type ContractAssetNote,
} from "./contract-quote-helpers";

/**
 * Contract quote generation (issue #210) and the per-contract quote list
 * (issue #211, item 7).
 *
 * `generateContractQuotes` — "Generate contract quotes" button on /quotes:
 *  - Candidates (issues #269/#270): ACTIVE contracts whose `next_invoice_date`
 *    is set and <= today (server date, UTC); in arrears additionally only once
 *    the period END is before today. Draft and ended contracts get no new
 *    period quotes.
 *  - Counter overage settlement period: in arrears = the invoiced period; in
 *    advance = the PREVIOUS period (none for the first quote). Stored on the
 *    quote (counter_settlement_start/end) whenever a counter line is settled,
 *    even with zero overage, and never settled twice (unique per contract).
 *    The per-asset baseline is the asset's coverage start (contract start or the
 *    date it was added; `contract_covered_assets` RPC): a reading on that date
 *    counts. Included quantity = line quantity x the billing multiplier.
 *  - Final settlement: in-advance contracts past their end date, fully invoiced,
 *    active or ended, get one extra quote (is_final_settlement, period start =
 *    end_date + 1) with only the last period's overage; nothing when there is none.
 *  - One quote per contract per run. A contract is SKIPPED when a contract
 *    quote already exists for (contract_id, contract_period_start =
 *    next_invoice_date) (a 23505 from the partial unique index is treated the
 *    same). `next_invoice_date` only advances once that quote is invoiced
 *    (DB trigger on invoices), so the following period is generated only
 *    after invoicing.
 *  - Period: start = next_invoice_date. With a recurring billing TERMS item
 *    (`interval_months`): end = contract start_date + (invoiced_period_count +
 *    1) x interval_months - 1 day (anchored on the contract start like the DB,
 *    so month-end starts stay contiguous). Non-recurring
 *    terms (per visit / one time) or no terms: end = contract end_date when
 *    set, else the start date itself (a one-off charge). The end is always
 *    capped at the contract's end_date.
 *  - Quote: quote_type 'contract', client = contract's client, no site,
 *    default (draft) status, name "<contract number> — <period>", no valid_until.
 *  - Lines come from contract_line_items. Their prices are per billing PERIOD
 *    (contracts.billing_period_id) while billing TERMS is the invoicing
 *    frequency, so multiplier = terms.interval_months / period.interval_months
 *    (period months from the item's interval_months, else monthly=1,
 *    quarterly=3, annually=12; if either is unknown/non-recurring: 1).
 *    The multiplier scales the quantity when quantity x multiplier is exact at
 *    2 decimals, otherwise the unit price (rounded to cents). Each line
 *    description gets the invoiced period appended.
 *  - `is_volume` lines (pre-agreed usage bundles, issue #129) are billed like
 *    any other contract line at their contracted quantity x price per period.
 *  - Counter settlement (issue #239): a volume line linked to a counter
 *    (`volume_item_id`) includes its own quantity (per billing PERIOD, so
 *    scaled by the same multiplier as the price) and gets an extra overage
 *    line at `overage_unit_price` when usage exceeds it. Usage = sum over
 *    the covered assets (direct contract_assets plus all their asset_components
 *    descendants, same coverage rule as listAssetContractCoverage) whose model
 *    has the counter configured, of (latest reading <= end of period end) -
 *    (latest reading <= start of period start); see counter-settlement.ts.
 *    Readings flagged needs_review are ignored; missing readings and counter
 *    resets (negative usage) skip the asset. All of that is reported as
 *    warnings (quote notes + result). The overage line reuses the contract
 *    line's article.
 *  - Quote notes: plain-text contract details + covered assets, so they are
 *    traceable and printed on the invoice.
 */

export interface GenerateContractQuotesResult {
  created: number;
  skipped: number;
  errors: { contractId: string; contractNumber: string; error: string }[];
  /** Quote was created, but counter settlement needs attention (issue #239). */
  warnings: { contractId: string; contractNumber: string; message: string }[];
}


interface ContractRow {
  id: string;
  client_id: string;
  contract_number: string;
  external_reference: string | null;
  start_date: string;
  end_date: string | null;
  next_invoice_date: string;
  invoiced_period_count: number;
  invoicing_timing: "in_advance" | "in_arrears";
  contract_type: { label: string } | null;
  billing_terms: { label: string; interval_months: number | null } | null;
  billing_period: { value: string; label: string; interval_months: number | null } | null;
  contract_line_items: {
    article_id: string;
    article_number: string | null;
    description: string | null;
    quantity: number | string;
    unit_price: number | string;
    sort_order: number;
    is_volume: boolean;
    volume_item_id: string | null;
    overage_unit_price: number | string | null;
    volume_item: { label: string } | null;
    article: { article_number: string; description: string } | null;
  }[];
  contract_assets: {
    asset_id: string;
    asset: {
      name: string;
      serial_number: string | null;
      external_reference: string | null;
      site: { address_line1: string | null; city: string | null } | null;
      asset_model: { name: string } | null;
    } | null;
  }[];
}

const CONTRACT_SELECT =
  "id, client_id, contract_number, external_reference, start_date, end_date, next_invoice_date, invoiced_period_count, invoicing_timing," +
  " contract_type:reference_list_items!contracts_type_id_fkey(label)," +
  " billing_terms:reference_list_items!contracts_billing_terms_id_fkey(label,interval_months)," +
  " billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,interval_months)," +
  " contract_line_items(article_id,article_number,description,quantity,unit_price,sort_order,is_volume," +
  "volume_item_id,overage_unit_price," +
  "volume_item:reference_list_items!contract_line_items_volume_item_id_fkey(label)," +
  "article:articles(article_number,description))," +
  " contract_assets(asset_id,asset:assets(name,serial_number,external_reference,site:sites(address_line1,city)," +
  "asset_model:asset_models!assets_model_id_fkey(name)))";

const MAX_CONTRACTS_PER_RUN = 500;
const IN_CHUNK = 100;
const PAGE_SIZE = 1000;

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface CounterData {
  /** contract id -> covered asset id -> coverage start (ISO date; direct + all
   * component descendants, from the `contract_covered_assets` SQL function). */
  coveredByContract: Map<string, Map<string, string>>;
  assets: Map<string, CounterAsset & { modelId: string | null }>;
  /** model id -> configured counter (volume item) ids. */
  countersByModel: Map<string, Set<string>>;
  /** `assetId|volumeItemId` -> readings. */
  readings: Map<string, CounterReading[]>;
}

/**
 * Bulk-loads everything counter settlement needs for the given contracts (all
 * with at least one counter line): coverage + per-asset coverage start (one RPC
 * per contract), asset names/models, counters per model and the readings up to
 * the latest settled period end. A handful of queries per run, not per asset.
 */
async function loadCounterData(
  supabase: Supabase,
  contracts: readonly ContractRow[],
  latestPeriodEnd: string,
): Promise<{ data: CounterData } | { error: string }> {
  const coveredByContract = new Map<string, Map<string, string>>();
  const allAssetIdSet = new Set<string>();
  for (const contract of contracts) {
    const { data, error } = await supabase.rpc("contract_covered_assets", { p_contract_id: contract.id });
    if (error) return { error: mapDbError(error) };
    const covered = new Map<string, string>();
    for (const row of (data ?? []) as { asset_id: string; coverage_start: string | null }[]) {
      covered.set(row.asset_id, row.coverage_start ?? contract.start_date);
      allAssetIdSet.add(row.asset_id);
    }
    coveredByContract.set(contract.id, covered);
  }

  const allAssetIds = [...allAssetIdSet];
  const assets = new Map<string, CounterAsset & { modelId: string | null }>();
  for (const ids of chunk(allAssetIds, IN_CHUNK)) {
    const { data, error } = await supabase.from("assets").select("id, name, model_id").in("id", ids);
    if (error) return { error: mapDbError(error) };
    for (const row of data ?? []) {
      assets.set(row.id as string, {
        id: row.id as string,
        name: row.name as string,
        modelId: (row.model_id as string | null) ?? null,
      });
    }
  }

  const modelIds = [...new Set([...assets.values()].map((a) => a.modelId).filter((id): id is string => Boolean(id)))];
  const countersByModel = new Map<string, Set<string>>();
  for (const ids of chunk(modelIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("asset_model_volumes")
      .select("asset_model_id, volume_item_id")
      .in("asset_model_id", ids);
    if (error) return { error: mapDbError(error) };
    for (const row of data ?? []) {
      const set = countersByModel.get(row.asset_model_id as string) ?? new Set<string>();
      set.add(row.volume_item_id as string);
      countersByModel.set(row.asset_model_id as string, set);
    }
  }

  // Only assets whose model has a counter that some contract line uses.
  const wantedVolumeIds = new Set<string>();
  for (const contract of contracts) {
    for (const line of contract.contract_line_items) {
      if (line.is_volume && line.volume_item_id) wantedVolumeIds.add(line.volume_item_id);
    }
  }
  const readingAssetIds = allAssetIds.filter((id) => {
    const modelId = assets.get(id)?.modelId;
    const counters = modelId ? countersByModel.get(modelId) : undefined;
    return counters ? [...wantedVolumeIds].some((v) => counters.has(v)) : false;
  });

  const readings = new Map<string, CounterReading[]>();
  const readUntil = `${addDaysIso(latestPeriodEnd, 1)}T00:00:00.000Z`;
  for (const ids of chunk(readingAssetIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("asset_volume_readings")
        .select("id, asset_id, volume_item_id, value, read_at, needs_review")
        .in("asset_id", ids)
        .in("volume_item_id", [...wantedVolumeIds])
        .lt("read_at", readUntil)
        .order("read_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { error: mapDbError(error) };
      for (const row of data ?? []) {
        const key = `${row.asset_id as string}|${row.volume_item_id as string}`;
        const list = readings.get(key) ?? [];
        list.push({
          assetId: row.asset_id as string,
          readAt: row.read_at as string,
          value: Number(row.value),
          needsReview: Boolean(row.needs_review),
        });
        readings.set(key, list);
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }

  return { data: { coveredByContract, assets, countersByModel, readings } };
}

type InvoiceEmbed = { invoice_number: string; kind: "invoice" | "credit_note"; credited_at: string | null };

/** A quote can have credited invoices and credit notes besides its live
 * invoice (issue #236); the contract's quote list shows the live one. */
function pickLiveInvoice(embed: InvoiceEmbed | InvoiceEmbed[] | null): { invoice_number: string } | null {
  const rows = Array.isArray(embed) ? embed : embed ? [embed] : [];
  return rows.find((r) => r.kind === "invoice" && r.credited_at === null) ?? null;
}

/** A contract quote still to generate: a normal period quote, or the extra
 * final counter settlement quote after the end date (issue #269). */
interface QuoteTask {
  contract: ContractRow;
  kind: "period" | "final";
  /** Period this quote invoices (fixed lines); for `final` the last period (no fixed lines). */
  period: { start: string; end: string };
  /** Counter period whose overage this quote settles; null = nothing to settle. */
  settlement: { start: string; end: string } | null;
}

export async function generateContractQuotes(): Promise<ActionResult<GenerateContractQuotesResult>> {
  const quotesCtx = await requireModuleContext("quotes");
  if (!quotesCtx.ok) return fail(quotesCtx.error);
  const contractsCtx = await requireModuleContext("contracts");
  if (!contractsCtx.ok) return fail(contractsCtx.error);
  const actor = quotesCtx.context.actor;

  if (!can(actor, "quotes", "create")) {
    return fail("Only an owner or planner can generate contract quotes.");
  }
  if (!canAny(actor, "contracts", ["read"])) {
    return fail("You do not have permission to view contracts.");
  }

  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  // Period quotes: ACTIVE contracts only (issue #270). In arrears the period
  // must also have ended (checked below, needs the computed period end).
  const { data: contractData, error: contractsError } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("status", "active")
    .not("next_invoice_date", "is", null)
    .lte("next_invoice_date", today)
    .order("next_invoice_date", { ascending: true })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (contractsError) return fail(mapDbError(contractsError));
  const periodContracts = (contractData ?? []) as unknown as ContractRow[];

  // Final settlement candidates: in advance, ended by date, fully invoiced.
  // Active or Ended status (an ended contract still gets its final settlement).
  const { data: finalData, error: finalError } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .in("status", ["active", "ended"])
    .eq("invoicing_timing", "in_advance")
    .not("end_date", "is", null)
    .lt("end_date", today)
    .is("next_invoice_date", null)
    .gte("invoiced_period_count", 1)
    .order("end_date", { ascending: true })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (finalError) return fail(mapDbError(finalError));
  const finalContracts = ((finalData ?? []) as unknown as ContractRow[]).filter((c) =>
    c.contract_line_items.some((l) => l.is_volume && l.volume_item_id),
  );

  const result: GenerateContractQuotesResult = { created: 0, skipped: 0, errors: [], warnings: [] };
  if (periodContracts.length === 0 && finalContracts.length === 0) return ok(result);

  // Existing contract quotes for these contracts -> skip sets.
  const allIds = [...new Set([...periodContracts, ...finalContracts].map((c) => c.id))];
  const existingRows: {
    contract_id: string;
    contract_period_start: string;
    counter_settlement_start: string | null;
    is_final_settlement: boolean;
  }[] = [];
  for (const ids of chunk(allIds, IN_CHUNK)) {
    const { data: existingData, error: existingError } = await supabase
      .from("quotes")
      .select("contract_id, contract_period_start, counter_settlement_start, is_final_settlement")
      .eq("quote_type", "contract")
      .in("contract_id", ids);
    if (existingError) return fail(mapDbError(existingError));
    existingRows.push(...((existingData ?? []) as typeof existingRows));
  }
  const existing = new Set(
    existingRows.filter((q) => !q.is_final_settlement).map((q) => `${q.contract_id}|${q.contract_period_start}`),
  );
  const settled = new Set(
    existingRows.filter((q) => q.counter_settlement_start).map((q) => `${q.contract_id}|${q.counter_settlement_start}`),
  );
  const finalExists = new Set(existingRows.filter((q) => q.is_final_settlement).map((q) => q.contract_id));

  const intervalOf = (contract: ContractRow) => contract.billing_terms?.interval_months ?? null;
  const hasCounterLine = (contract: ContractRow) =>
    contract.contract_line_items.some((l) => l.is_volume && l.volume_item_id);

  const tasks: QuoteTask[] = [];
  for (const contract of periodContracts) {
    if (existing.has(`${contract.id}|${contract.next_invoice_date}`)) {
      result.skipped += 1;
      continue;
    }
    const period = computeContractPeriod(
      contract.next_invoice_date,
      contract.start_date,
      contract.invoiced_period_count,
      intervalOf(contract),
      contract.end_date,
    );
    if (!isPeriodQuoteDue(contract.invoicing_timing, period, today)) continue;
    let settlement = hasCounterLine(contract)
      ? planSettlementPeriod({
          timing: contract.invoicing_timing,
          invoicedPeriod: period,
          contractStart: contract.start_date,
          contractEnd: contract.end_date,
          invoicedPeriodCount: contract.invoiced_period_count,
          intervalMonths: intervalOf(contract),
        })
      : null;
    // A period's usage is never settled twice (regenerating / crediting).
    if (settlement && settled.has(`${contract.id}|${settlement.start}`)) settlement = null;
    tasks.push({ contract, kind: "period", period, settlement });
  }
  for (const contract of finalContracts) {
    if (finalExists.has(contract.id)) continue;
    const last = contractPeriodByIndex(
      contract.start_date,
      contract.invoiced_period_count - 1,
      intervalOf(contract),
      contract.end_date,
    );
    if (settled.has(`${contract.id}|${last.start}`)) continue;
    tasks.push({ contract, kind: "final", period: last, settlement: last });
  }

  // Counter settlement data, loaded once for every task that settles a counter.
  const counterTasks = tasks.filter((t) => t.settlement && hasCounterLine(t.contract));
  let counterData: CounterData | null = null;
  let counterLoadError: string | null = null;
  if (counterTasks.length > 0) {
    const latestEnd = counterTasks.map((t) => (t.settlement as { end: string }).end).reduce((a, b) => (a > b ? a : b));
    const loaded = await loadCounterData(
      supabase,
      [...new Map(counterTasks.map((t) => [t.contract.id, t.contract])).values()],
      latestEnd,
    );
    if ("error" in loaded) counterLoadError = loaded.error;
    else counterData = loaded.data;
  }

  for (const task of tasks) {
    const { contract, settlement } = task;
    const isFinal = task.kind === "final";
    const period = task.period;
    const periodLabel = formatPeriodLabel(period.start, period.end);
    const settlementLabel = settlement ? formatPeriodLabel(settlement.start, settlement.end) : null;

    const termsMonths = contract.billing_terms?.interval_months ?? null;
    const multiplier = billingMultiplier(termsMonths, billingPeriodMonths(contract.billing_period));

    const assets: ContractAssetNote[] = contract.contract_assets
      .map((link) => link.asset)
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => ({
        name: asset.name,
        serialNumber: asset.serial_number,
        externalReference: asset.external_reference,
        model: asset.asset_model?.name ?? null,
        siteName: formatSiteAddressShort(asset.site),
      }));

    // Counter settlement: overage lines + warnings per volume line with a counter.
    // The included quantity is the line quantity x the billing multiplier of the
    // SETTLED period (same multiplier as an invoiced period).
    let overageLines: {
      articleId: string;
      articleNumber: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    const warnings: string[] = [];
    let settledCounterLine = false;
    if (settlement && settlementLabel) {
      if (!counterData) {
        result.errors.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          error: `Counter usage could not be settled (${counterLoadError ?? "no data"}).`,
        });
        continue;
      }
      const data = counterData;
      const baselines = data.coveredByContract.get(contract.id) ?? new Map<string, string>();
      for (const line of contract.contract_line_items) {
        if (!line.is_volume || !line.volume_item_id) continue;
        settledCounterLine = true;
        const counterLabel = line.volume_item?.label ?? "Counter";
        const volumeItemId = line.volume_item_id;
        const covered = [...baselines.keys()]
          .map((id) => data.assets.get(id))
          .filter((a): a is NonNullable<typeof a> => {
            if (!a?.modelId) return false;
            return data.countersByModel.get(a.modelId)?.has(volumeItemId) ?? false;
          });
        const readings = covered.flatMap((a) => data.readings.get(`${a.id}|${volumeItemId}`) ?? []);
        const usage = computeCounterUsage(
          covered.map((a) => ({ id: a.id, name: a.name })),
          readings,
          settlement.start,
          settlement.end,
          baselines,
        );
        for (const issue of usage.issues) warnings.push(`${counterLabel}: ${issue}`);
        if (usage.reviewReadingsInPeriod > 0) {
          warnings.push(
            `${counterLabel}: ${usage.reviewReadingsInPeriod} reading(s) in the settled period need review and were ignored.`,
          );
        }
        // The line quantity is the included counter quantity per billing
        // PERIOD, scaled to the invoice: 500/month invoiced quarterly = 1,500.
        const included = Math.round(Number(line.quantity) * multiplier * 1000) / 1000;
        const overage = computeOverage(usage.usage, included);
        if (overage <= 0) continue;
        if (line.overage_unit_price === null) {
          warnings.push(
            `${counterLabel}: usage exceeds the included quantity but the line has no overage price; no overage line added.`,
          );
          continue;
        }
        overageLines.push({
          articleId: line.article_id,
          articleNumber: line.article_number ?? line.article?.article_number ?? null,
          description: describeOverage(counterLabel, usage.usage, included, overage, settlementLabel),
          quantity: overage,
          unitPrice: Number(line.overage_unit_price),
        });
      }
    }

    if (isFinal && overageLines.length === 0) {
      // Nothing to bill: no quote (re-evaluated on the next run), warnings still reported.
      result.skipped += 1;
      for (const message of warnings) {
        result.warnings.push({ contractId: contract.id, contractNumber: contract.contract_number, message });
      }
      continue;
    }

    const buildNotes = (withSettlement: boolean) =>
      [
        `Contract: ${contract.contract_number}${contract.external_reference ? ` — ${contract.external_reference}` : ""}`,
        contract.contract_type ? `Type: ${contract.contract_type.label}` : null,
        contract.billing_terms ? `Billing terms: ${contract.billing_terms.label}` : null,
        contract.billing_period ? `Billing period: ${contract.billing_period.label}` : null,
        contract.invoicing_timing === "in_arrears" ? "Invoicing: in arrears" : "Invoicing: in advance",
        isFinal ? `Final counter settlement after the contract end date` : `Period invoiced: ${periodLabel}`,
        withSettlement && settlementLabel ? `Counter usage settled: ${settlementLabel}` : null,
        `Contract start: ${formatPeriodLabel(contract.start_date, null)}`,
        `Contract end: ${contract.end_date ? formatPeriodLabel(contract.end_date, null) : "open-ended"}`,
        "",
        describeContractAssets(assets),
        withSettlement && warnings.length > 0
          ? `\nCounter settlement warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n")
        .trim();

    const name = (
      isFinal
        ? `${contract.contract_number} — Final counter settlement ${settlementLabel ?? periodLabel}`
        : `${contract.contract_number} — ${periodLabel}`
    ).slice(0, 200);

    // A final settlement quote sits after the contract end (period start =
    // end_date + 1) so credit_invoice()'s "latest period" rule keeps working.
    const quotePeriodStart = isFinal ? addDaysIso(contract.end_date as string, 1) : period.start;
    const quotePeriodEnd = isFinal ? quotePeriodStart : period.end;

    const insertQuote = (withSettlement: boolean) =>
      supabase
        .from("quotes")
        .insert({
          client_id: contract.client_id,
          name,
          notes: buildNotes(withSettlement),
          quote_type: "contract",
          contract_id: contract.id,
          contract_period_start: quotePeriodStart,
          contract_period_end: quotePeriodEnd,
          ...(withSettlement && settlement && settledCounterLine
            ? {
                counter_settlement_start: settlement.start,
                counter_settlement_end: settlement.end,
                ...(isFinal ? { is_final_settlement: true } : {}),
              }
            : {}),
        })
        .select("id")
        .single<{ id: string }>();

    let { data: quote, error: quoteError } = await insertQuote(true);
    if (quoteError?.code === "23505" && !isFinal && settledCounterLine) {
      // Settlement of that period was claimed in the meantime (unique index
      // backstop): still create the period quote, without settling again.
      overageLines = [];
      warnings.length = 0;
      settledCounterLine = false;
      ({ data: quote, error: quoteError } = await insertQuote(false));
    }

    if (quoteError || !quote) {
      if (quoteError?.code === "23505") {
        result.skipped += 1;
      } else {
        result.errors.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          error: quoteError ? mapDbError(quoteError) : "Quote could not be created.",
        });
      }
      continue;
    }

    const lineRows = isFinal
      ? []
      : [...contract.contract_line_items]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((line, index) => {
            const scaled = scaleContractLine(Number(line.quantity), Number(line.unit_price), multiplier);
            const baseDescription = line.description ?? line.article?.description ?? "Contract line";
            return {
              quote_id: quote.id,
              article_id: line.article_id,
              article_number: line.article_number ?? line.article?.article_number ?? null,
              description: `${baseDescription} (${periodLabel})`.slice(0, 2000),
              quantity: scaled.quantity,
              unit_price: scaled.unitPrice,
              sort_order: index,
            };
          });

    for (const overage of overageLines) {
      lineRows.push({
        quote_id: quote.id,
        article_id: overage.articleId,
        article_number: overage.articleNumber,
        description: overage.description.slice(0, 2000),
        quantity: overage.quantity,
        unit_price: overage.unitPrice,
        sort_order: lineRows.length,
      });
    }

    if (lineRows.length > 0) {
      const { error: linesError } = await supabase.from("quote_line_items").insert(lineRows);
      if (linesError) {
        // Roll back the half-built quote so the next run can retry cleanly.
        await supabase.from("quotes").delete().eq("id", quote.id);
        result.errors.push({ contractId: contract.id, contractNumber: contract.contract_number, error: mapDbError(linesError) });
        continue;
      }
    }

    for (const message of warnings) {
      result.warnings.push({ contractId: contract.id, contractNumber: contract.contract_number, message });
    }
    result.created += 1;
  }

  return ok(result);
}

// ---------------------------------------------------------------------------
// Quotes of one contract (contract detail screen)
// ---------------------------------------------------------------------------

export interface ContractQuoteRecord {
  id: string;
  name: string;
  quote_type: "default" | "contract";
  status: { value: string; label: string; color: string | null } | null;
  contract_period_start: string | null;
  contract_period_end: string | null;
  /** Counter period whose overage this quote settles (issue #269), if any. */
  counter_settlement_start: string | null;
  counter_settlement_end: string | null;
  /** Extra quote after the end date with only the last period's overage. */
  is_final_settlement: boolean;
  total: number;
  created_at: string;
  /** Null while not invoiced, and for roles that cannot read invoices
   * (invoices are owner/administratie only). */
  invoice_number: string | null;
}

/** All quotes (any status) generated for / linked to `contractId`, newest
 * first. Org-scoped via RLS. */
export async function listQuotesForContract(
  contractId: string,
): Promise<ActionResult<{ quotes: ContractQuoteRecord[] }>> {
  const idResult = z.string().uuid("Invalid contract id.").safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "quotes", ["read"])) {
    return fail("You do not have permission to view quotes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, name, quote_type, contract_period_start, contract_period_end, created_at," +
        " counter_settlement_start, counter_settlement_end, is_final_settlement," +
        " quote_status:reference_list_items!quotes_status_id_fkey(value,label,color)," +
        " quote_line_items(quantity,unit_price,discount_percent)," +
        " invoice:invoices(invoice_number,kind,credited_at)",
    )
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: false });
  if (error) return fail(mapDbError(error));

  type Row = {
    id: string;
    name: string;
    quote_type: "default" | "contract";
    contract_period_start: string | null;
    contract_period_end: string | null;
    counter_settlement_start: string | null;
    counter_settlement_end: string | null;
    is_final_settlement: boolean;
    created_at: string;
    quote_status: { value: string; label: string; color: string | null } | null;
    quote_line_items: { quantity: number | string; unit_price: number | string; discount_percent: number | string }[];
    invoice: InvoiceEmbed | InvoiceEmbed[] | null;
  };

  const quotes = ((data ?? []) as unknown as Row[]).map((row): ContractQuoteRecord => {
    const sum = row.quote_line_items.reduce(
      (acc, item) => acc + Number(item.quantity) * Number(item.unit_price) * (1 - Number(item.discount_percent) / 100),
      0,
    );
    const invoice = pickLiveInvoice(row.invoice);
    return {
      id: row.id,
      name: row.name,
      quote_type: row.quote_type,
      status: row.quote_status,
      contract_period_start: row.contract_period_start,
      contract_period_end: row.contract_period_end,
      counter_settlement_start: row.counter_settlement_start,
      counter_settlement_end: row.counter_settlement_end,
      is_final_settlement: row.is_final_settlement,
      total: Math.round(sum * 100) / 100,
      created_at: row.created_at,
      invoice_number: invoice?.invoice_number ?? null,
    };
  });

  return ok({ quotes });
}
