/**
 * Shared contract select + row shape for contract quote generation
 * (contract-quote-actions.ts) and the contract end flow (contracts/end-actions.ts),
 * issue #271. Plain module (not "use server"): a Server Action file may only export
 * async functions.
 */

import type { BalanceContractLine, SettlementFrequency } from "./contract-balance";

export interface ContractRow {
  status: "draft" | "active" | "ended";
  end_scheduled_at: string | null;
  id: string;
  client_id: string;
  contract_number: string;
  external_reference: string | null;
  start_date: string;
  end_date: string | null;
  next_invoice_date: string | null;
  invoiced_period_count: number;
  invoicing_timing: "in_advance" | "in_arrears";
  counter_settlement_frequency: SettlementFrequency;
  counter_settlement_month: number | null;
  contract_type: { label: string } | null;
  billing_terms: { label: string; interval_months: number | null } | null;
  billing_period: { value: string; label: string; interval_months: number | null } | null;
  contract_line_items: {
    id: string;
    article_id: string;
    article_number: string | null;
    description: string | null;
    quantity: number | string;
    unit_price: number | string;
    sort_order: number;
    is_volume: boolean;
    volume_item_id: string | null;
    overage_unit_price: number | string | null;
    credit_under_use: boolean;
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

export const CONTRACT_SELECT =
  "id, client_id, status, end_scheduled_at, contract_number, external_reference, start_date, end_date, next_invoice_date, invoiced_period_count, invoicing_timing," +
  " counter_settlement_frequency, counter_settlement_month," +
  " contract_type:reference_list_items!contracts_type_id_fkey(label)," +
  " billing_terms:reference_list_items!contracts_billing_terms_id_fkey(label,interval_months)," +
  " billing_period:reference_list_items!contracts_billing_period_id_fkey(value,label,interval_months)," +
  " contract_line_items(id,article_id,article_number,description,quantity,unit_price,sort_order,is_volume," +
  "volume_item_id,overage_unit_price,credit_under_use," +
  "volume_item:reference_list_items!contract_line_items_volume_item_id_fkey(label)," +
  "article:articles(article_number,description))," +
  " contract_assets(asset_id,asset:assets(name,serial_number,external_reference,site:sites(address_line1,city)," +
  "asset_model:asset_models!assets_model_id_fkey(name)))";


export function toBalanceLines(contract: ContractRow): BalanceContractLine[] {
  return contract.contract_line_items.map((l) => ({
    id: l.id,
    articleId: l.article_id,
    articleNumber: l.article_number ?? l.article?.article_number ?? null,
    description: l.description ?? l.article?.description ?? "Contract line",
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    sortOrder: l.sort_order,
    isVolume: l.is_volume,
    volumeItemId: l.volume_item_id,
    counterLabel: l.volume_item?.label ?? "Counter",
    overageUnitPrice: l.overage_unit_price === null ? null : Number(l.overage_unit_price),
    creditUnderUse: l.credit_under_use,
  }));
}

