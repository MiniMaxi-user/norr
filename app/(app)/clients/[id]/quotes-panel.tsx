"use client";

import { useMemo } from "react";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn } from "@yourorg/ui/web-client";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";

export interface QuotesPanelProps {
  quotes: QuoteRecord[];
}

/** Quotes that are still in play (not yet decided or invoiced). */
const OPEN_QUOTE_STATUS_VALUES = ["draft", "sent"];
const isOpen = (quote: QuoteRecord) => OPEN_QUOTE_STATUS_VALUES.includes(quote.quote_status?.value ?? "");

/**
 * Quotes tab (docs/ARCHITECTURE.md "Relational detail pages"; design-system
 * table pattern, issue #222) — every pre-sale proposal for this client, one
 * card with a FilterBar: Status dropdown and Open · Closed · All (Open =
 * draft or sent). Deliberately no add button — explicit product-owner call
 * (most quotes arrive via a work order's auto-draft, issue #109); quotes are
 * created from `/quotes`.
 */
export function QuotesPanel({ quotes }: QuotesPanelProps) {
  const columns = useMemo<WebColumn<QuoteRecord>[]>(
    () => [
      { id: "name", header: "Name", primary: true, sortValue: (quote) => quote.name, render: (quote) => quote.name },
      {
        id: "status",
        header: "Status",
        sortValue: (quote) => quote.quote_status?.label ?? "",
        render: (quote) =>
          quote.quote_status ? (
            <StatusText display="badge" tone={toneFromColor(quote.quote_status.color)}>{quote.quote_status.label}</StatusText>
          ) : (
            "—"
          ),
      },
      {
        id: "validUntil",
        header: "Valid until",
        sortValue: (quote) => quote.valid_until,
        render: (quote) => formatDateWeb(quote.valid_until),
      },
      {
        id: "total",
        header: "Total",
        align: "end",
        sortValue: (quote) => quote.total,
        render: (quote) => formatMoneyWeb(quote.total),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        getOptions: (quote: QuoteRecord) =>
          quote.quote_status ? [{ value: quote.quote_status.value, label: quote.quote_status.label }] : [],
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
        { value: "closed", label: "Closed", match: (quote: QuoteRecord) => !isOpen(quote) },
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
      searchText={(quote) => `${quote.name} ${quote.quote_status?.label ?? ""}`}
      noun="quotes"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="quotes"
      defaultSort={{ columnId: "name", direction: "asc" }}
      rowHref={(quote) => `/quotes/${quote.id}`}
      rowLabel={(quote) => quote.name}
    />
  );
}
