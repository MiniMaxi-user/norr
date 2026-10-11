"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import {
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
 *  - Quote: quote_type 'contract', client = contract's client, site = the
 *    client's first `is_invoice_address` site (none otherwise), default
 *    (draft) status, name "<contract name> — <period>", no valid_until.
 *  - Lines come from contract_line_items. Their prices are per billing PERIOD
 *    (contracts.billing_period_id) while billing TERMS is the invoicing
 *    frequency, so multiplier = terms.interval_months / period.interval_months
 *    (period months from the item's interval_months, else monthly=1,
 *    quarterly=3, annually=12; if either is unknown/non-recurring: 1).
 *    The multiplier scales the quantity when quantity x multiplier is exact at
 *    2 decimals, otherwise the unit price (rounded to cents). Each line
 *    description gets the invoiced period appended.
 *  - `is_volume` lines (pre-agreed usage bundles, issue #129) are billed like
 *    any other contract line at their contracted quantity x price per period;
 *    there is no usage settlement yet (that is a separate future story).
 *  - Quote notes: plain-text contract details + covered assets, so they are
 *    traceable and printed on the invoice.
 */

export interface GenerateContractQuotesResult {
  created: number;
  skipped: number;
  errors: { contractId: string; contractName: string; error: string }[];
}

const BILLING_PERIOD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };

interface ContractRow {
  id: string;
  client_id: string;
  name: string;
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
    article: { article_number: string; description: string } | null;
  }[];
  contract_assets: {
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
  "id, client_id, name, start_date, end_date, next_invoice_date, invoiced_period_count," +
  " contract_type:reference_list_items!contracts_type_id_fkey(label)," +
  " billing_terms:reference_list_items!contracts_billing_terms_id_fkey(label,interval_months)," +
  " billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,interval_months)," +
  " contract_line_items(article_id,article_number,description,quantity,unit_price,sort_order," +
  "article:articles(article_number,description))," +
  " contract_assets(asset:assets(name,serial_number,external_reference,site:sites(address_line1,city)," +
  "asset_model:asset_models!assets_model_id_fkey(name)))";

const MAX_CONTRACTS_PER_RUN = 500;

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

  const result: GenerateContractQuotesResult = { created: 0, skipped: 0, errors: [] };
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

  // Invoice-address site per client (first one wins), loaded in one query.
  const clientIds = Array.from(new Set(contracts.map((c) => c.client_id)));
  const { data: siteData, error: siteError } = await supabase
    .from("sites")
    .select("id, client_id")
    .in("client_id", clientIds)
    .eq("is_invoice_address", true)
    .order("created_at", { ascending: true });
  if (siteError) return fail(mapDbError(siteError));
  const invoiceSiteByClient = new Map<string, string>();
  for (const site of siteData ?? []) {
    if (!invoiceSiteByClient.has(site.client_id as string)) invoiceSiteByClient.set(site.client_id as string, site.id as string);
  }

  for (const contract of contracts) {
    const start = contract.next_invoice_date;
    if (existing.has(`${contract.id}|${start}`)) {
      result.skipped += 1;
      continue;
    }

    const period = computeContractPeriod(
      start,
      contract.start_date,
      contract.invoiced_period_count,
      contract.billing_terms?.interval_months ?? null,
      contract.end_date,
    );
    const periodLabel = formatPeriodLabel(period.start, period.end);

    const termsMonths = contract.billing_terms?.interval_months ?? null;
    const periodMonths = contract.billing_period
      ? (contract.billing_period.interval_months ?? BILLING_PERIOD_MONTHS[contract.billing_period.value] ?? null)
      : null;
    const multiplier = termsMonths && periodMonths ? termsMonths / periodMonths : 1;

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

    const notes = [
      `Contract: ${contract.name}`,
      contract.contract_type ? `Type: ${contract.contract_type.label}` : null,
      contract.billing_terms ? `Billing terms: ${contract.billing_terms.label}` : null,
      contract.billing_period ? `Billing period: ${contract.billing_period.label}` : null,
      `Period invoiced: ${periodLabel}`,
      `Contract start: ${formatPeriodLabel(contract.start_date, null)}`,
      `Contract end: ${contract.end_date ? formatPeriodLabel(contract.end_date, null) : "open-ended"}`,
      "",
      describeContractAssets(assets),
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim();

    const name = `${contract.name} — ${periodLabel}`.slice(0, 200);

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .insert({
        client_id: contract.client_id,
        site_id: invoiceSiteByClient.get(contract.client_id) ?? null,
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
        result.errors.push({ contractId: contract.id, contractName: contract.name, error: mapDbError(quoteError) });
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

    if (lineRows.length > 0) {
      const { error: linesError } = await supabase.from("quote_line_items").insert(lineRows);
      if (linesError) {
        // Roll back the half-built quote so the next run can retry cleanly.
        await supabase.from("quotes").delete().eq("id", quote.id);
        result.errors.push({ contractId: contract.id, contractName: contract.name, error: mapDbError(linesError) });
        continue;
      }
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
        " invoice:invoices(invoice_number)",
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
    invoice: { invoice_number: string } | { invoice_number: string }[] | null;
  };

  const quotes = ((data ?? []) as unknown as Row[]).map((row): ContractQuoteRecord => {
    const sum = row.quote_line_items.reduce(
      (acc, item) => acc + Number(item.quantity) * Number(item.unit_price) * (1 - Number(item.discount_percent) / 100),
      0,
    );
    const invoice = Array.isArray(row.invoice) ? (row.invoice[0] ?? null) : row.invoice;
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
