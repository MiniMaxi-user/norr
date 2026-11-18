"use client";

import { useMemo } from "react";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn } from "@yourorg/ui/web-client";
import type { ContractQuoteRecord } from "@/app/(app)/quotes/contract-quote-actions";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";

export interface ContractQuotesPanelProps {
  quotes: ContractQuoteRecord[];
}

/** Quotes that are still in play (not yet decided or invoiced). */
const OPEN_STATUS_VALUES = ["draft", "sent"];
const isOpen = (quote: ContractQuoteRecord) => OPEN_STATUS_VALUES.includes(quote.status?.value ?? "");

/**
 * Quotes tab (design system, issue #222): every quote generated for this
 * contract (drafts and invoiced alike) as one card with a FilterBar — Status
 * dropdown and Open · Closed · All (Open = draft or sent). Read-only and
 * deliberately without an add button: contract quotes are generated from the
 * Quotes module ("Generate contract quotes"). Rows open the quote.
 */
export function ContractQuotesPanel({ quotes }: ContractQuotesPanelProps) {
  const columns = useMemo<WebColumn<ContractQuoteRecord>[]>(
    () => [
      { id: "name", header: "Quote", primary: true, sortValue: (quote) => quote.name, render: (quote) => quote.name },
      {
        id: "period",
        header: "Period",
        sortValue: (quote) => quote.contract_period_start,
        render: (quote) =>
          quote.contract_period_start && quote.contract_period_end
            ? `${formatDateWeb(quote.contract_period_start)} – ${formatDateWeb(quote.contract_period_end)}`
            : "—",
      },
      {
        id: "status",
        header: "Status",
        sortValue: (quote) => quote.status?.label ?? "",
        render: (quote) =>
          quote.status ? <StatusText tone={toneFromColor(quote.status.color)}>{quote.status.label}</StatusText> : "—",
      },
      {
        id: "total",
        header: "Total",
        align: "end",
        sortValue: (quote) => quote.total,
        render: (quote) => formatMoneyWeb(quote.total),
      },
      {
        id: "invoice",
        header: "Invoice",
        mono: true,
        sortValue: (quote) => quote.invoice_number ?? "",
        render: (quote) => quote.invoice_number ?? "—",
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        getOptions: (quote: ContractQuoteRecord) =>
          quote.status ? [{ value: quote.status.value, label: quote.status.label }] : [],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show quotes",
      defaultValue: "all",
      options: [
        { value: "open", label: "Open", match: isOpen },
        { value: "closed", label: "Closed", match: (quote: ContractQuoteRecord) => !isOpen(quote) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  return (
    <WebDataTableCard
      title="Quotes"
      meta={String(quotes.length)}
      rows={quotes}
      getRowKey={(quote) => quote.id}
      columns={columns}
      searchText={(quote) => `${quote.name} ${quote.status?.label ?? ""} ${quote.invoice_number ?? ""}`}
      noun="quotes"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="quotes"
      defaultSort={{ columnId: "period", direction: "desc" }}
      rowHref={(quote) => `/quotes/${quote.id}`}
      rowLabel={(quote) => quote.name}
    />
  );
}
