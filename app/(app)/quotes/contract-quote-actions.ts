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
  describeOverage,
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
 *  - Candidates: the org's contracts whose `next_invoice_date` is set and
 *    <= today (server date, UTC).
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
 *    (`volume_item_id`) with `included_quantity` (per billing PERIOD, like
 *    the price, so scaled by the same multiplier) gets an extra overage line when usage exceeds it. Usage = sum over
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
    included_quantity: number | string | null;
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
  "id, client_id, contract_number, external_reference, start_date, end_date, next_invoice_date, invoiced_period_count," +
  " contract_type:reference_list_items!contracts_type_id_fkey(label)," +
  " billing_terms:reference_list_items!contracts_billing_terms_id_fkey(label,interval_months)," +
  " billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,interval_months)," +
  " contract_line_items(article_id,article_number,description,quantity,unit_price,sort_order,is_volume," +
  "volume_item_id,included_quantity,overage_unit_price," +
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
  /** contract id -> covered asset ids (direct + all component descendants). */
  coveredByContract: Map<string, Set<string>>;
  assets: Map<string, CounterAsset & { modelId: string | null }>;
  /** model id -> configured counter (volume item) ids. */
  countersByModel: Map<string, Set<string>>;
  /** `assetId|volumeItemId` -> readings. */
  readings: Map<string, CounterReading[]>;
}

/**
 * Bulk-loads everything counter settlement needs for the given contracts (all
 * with at least one counter line): coverage (direct + descendants through
 * asset_components, walked down level by level), asset names/models, counters
 * per model and the readings up to the latest period end. A handful of queries
 * per run, not per asset.
 */
async function loadCounterData(
  supabase: Supabase,
  contracts: readonly ContractRow[],
  latestPeriodEnd: string,
): Promise<{ data: CounterData } | { error: string }> {
  const coveredByContract = new Map<string, Set<string>>();
  const allRoots = new Set<string>();
  for (const contract of contracts) {
    const roots = new Set(contract.contract_assets.map((link) => link.asset_id));
    coveredByContract.set(contract.id, roots);
    roots.forEach((id) => allRoots.add(id));
  }

  // Walk down the composition tree: parent -> children, one query per level.
  const childrenByParent = new Map<string, string[]>();
  const visited = new Set<string>(allRoots);
  let frontier = [...allRoots];
  for (let depth = 0; depth < 100 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const ids of chunk(frontier, IN_CHUNK)) {
      const { data, error } = await supabase
        .from("asset_components")
        .select("parent_asset_id, component_asset_id")
        .in("parent_asset_id", ids);
      if (error) return { error: mapDbError(error) };
      for (const row of data ?? []) {
        const parentId = row.parent_asset_id as string;
        const childId = row.component_asset_id as string;
        childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), childId]);
        if (!visited.has(childId)) {
          visited.add(childId);
          next.push(childId);
        }
      }
    }
    frontier = next;
  }

  for (const covered of coveredByContract.values()) {
    const stack = [...covered];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const child of childrenByParent.get(id) ?? []) {
        if (!covered.has(child)) {
          covered.add(child);
          stack.push(child);
        }
      }
    }
  }

  const allAssetIds = [...visited];
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

  const { data: contractData, error: contractsError } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .not("next_invoice_date", "is", null)
    .lte("next_invoice_date", today)
    .order("next_invoice_date", { ascending: true })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (contractsError) return fail(mapDbError(contractsError));
  const contracts = (contractData ?? []) as unknown as ContractRow[];

  const result: GenerateContractQuotesResult = { created: 0, skipped: 0, errors: [], warnings: [] };
  if (contracts.length === 0) return ok(result);

  // Existing contract quotes for these contracts -> skip set.
  const { data: existingData, error: existingError } = await supabase
    .from("quotes")
    .select("contract_id, contract_period_start")
    .eq("quote_type", "contract")
    .in(
      "contract_id",
      contracts.map((c) => c.id),
    );
  if (existingError) return fail(mapDbError(existingError));
  const existing = new Set(
    (existingData ?? []).map((q) => `${q.contract_id as string}|${q.contract_period_start as string}`),
  );

  const periodOf = (contract: ContractRow) =>
    computeContractPeriod(
      contract.next_invoice_date,
      contract.start_date,
      contract.invoiced_period_count,
      contract.billing_terms?.interval_months ?? null,
      contract.end_date,
    );

  // Counter settlement data, loaded once for every contract still to generate.
  const counterContracts = contracts.filter(
    (c) =>
      !existing.has(`${c.id}|${c.next_invoice_date}`) && c.contract_line_items.some((l) => l.is_volume && l.volume_item_id),
  );
  let counterData: CounterData | null = null;
  let counterLoadError: string | null = null;
  if (counterContracts.length > 0) {
    const latestEnd = counterContracts.map((c) => periodOf(c).end).reduce((a, b) => (a > b ? a : b));
    const loaded = await loadCounterData(supabase, counterContracts, latestEnd);
    if ("error" in loaded) counterLoadError = loaded.error;
    else counterData = loaded.data;
  }

  for (const contract of contracts) {
    const start = contract.next_invoice_date;
    if (existing.has(`${contract.id}|${start}`)) {
      result.skipped += 1;
      continue;
    }

    const period = periodOf(contract);
    const periodLabel = formatPeriodLabel(period.start, period.end);

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
    const overageLines: {
      articleId: string;
      articleNumber: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    const warnings: string[] = [];
    for (const line of contract.contract_line_items) {
      if (!line.is_volume || !line.volume_item_id) continue;
      const counterLabel = line.volume_item?.label ?? "Counter";
      if (!counterData) {
        warnings.push(`${counterLabel}: usage could not be settled (${counterLoadError ?? "no data"}).`);
        continue;
      }
      const data = counterData;
      const volumeItemId = line.volume_item_id;
      const covered = [...(data.coveredByContract.get(contract.id) ?? [])]
        .map((id) => data.assets.get(id))
        .filter((a): a is NonNullable<typeof a> => {
          if (!a?.modelId) return false;
          return data.countersByModel.get(a.modelId)?.has(volumeItemId) ?? false;
        });
      const readings = covered.flatMap((a) => data.readings.get(`${a.id}|${volumeItemId}`) ?? []);
      const usage = computeCounterUsage(
        covered.map((a) => ({ id: a.id, name: a.name })),
        readings,
        period.start,
        period.end,
      );
      for (const issue of usage.issues) warnings.push(`${counterLabel}: ${issue}`);
      if (usage.reviewReadingsInPeriod > 0) {
        warnings.push(
          `${counterLabel}: ${usage.reviewReadingsInPeriod} reading(s) in this period need review and were ignored.`,
        );
      }
      if (line.included_quantity === null) continue;
      // Included is per billing PERIOD (like the line's price), so it scales
      // with the invoicing frequency: 500/month invoiced quarterly = 1,500.
      const included = Math.round(Number(line.included_quantity) * multiplier * 1000) / 1000;
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
        description: describeOverage(counterLabel, usage.usage, included, overage, periodLabel),
        quantity: overage,
        unitPrice: Number(line.overage_unit_price),
      });
    }

    const notes = [
      `Contract: ${contract.contract_number}${contract.external_reference ? ` — ${contract.external_reference}` : ""}`,
      contract.contract_type ? `Type: ${contract.contract_type.label}` : null,
      contract.billing_terms ? `Billing terms: ${contract.billing_terms.label}` : null,
      contract.billing_period ? `Billing period: ${contract.billing_period.label}` : null,
      `Period invoiced: ${periodLabel}`,
      `Contract start: ${formatPeriodLabel(contract.start_date, null)}`,
      `Contract end: ${contract.end_date ? formatPeriodLabel(contract.end_date, null) : "open-ended"}`,
      "",
      describeContractAssets(assets),
      warnings.length > 0 ? `\nCounter settlement warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim();

    const name = `${contract.contract_number} — ${periodLabel}`.slice(0, 200);

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .insert({
        client_id: contract.client_id,
        name,
        notes,
        quote_type: "contract",
        contract_id: contract.id,
        contract_period_start: period.start,
        contract_period_end: period.end,
      })
      .select("id")
      .single<{ id: string }>();

    if (quoteError) {
      if (quoteError.code === "23505") {
        result.skipped += 1;
      } else {
        result.errors.push({ contractId: contract.id, contractNumber: contract.contract_number, error: mapDbError(quoteError) });
      }
      continue;
    }

    const lineRows = [...contract.contract_line_items]
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
      total: Math.round(sum * 100) / 100,
      created_at: row.created_at,
      invoice_number: invoice?.invoice_number ?? null,
    };
  });

  return ok({ quotes });
}
