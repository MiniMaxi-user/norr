"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusText, WebDataTableCard, toneFromColor, type FilterOption, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { QuoteRecord } from "../actions";
import { DeleteQuoteDialog } from "./delete-quote-dialog";
import { QUOTE_TYPE_OPTIONS, QUOTES_DROPDOWN_IDS, QUOTES_OPEN_SEGMENT, QUOTES_PAGE_SIZE } from "./quotes-query";

export interface QuotesTableProps {
  quotes: QuoteRecord[];
  clientNameById: Map<string, string>;
  /** Filter choices (see `quotes-query.ts`). */
  clientOptions: FilterOption[];
  statusOptions: FilterOption[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  /** Issue #109 — `true` (only when the header's "Show auto-drafts" is on)
   * marks rows with `is_auto_draft` as "Concept" next to the Name. */
  showDraftBadge?: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

/**
 * Quotes list table (list-page shell, issue #222): a `WebDataTableCard` in
 * server mode. `listQuotes` (driven by the `q`, `status`, `type`, `clientId`,
 * `drafts`, `seg`, `sort`, `dir` and `page` URL params) returns the filtered
 * page; this component renders it. A row (or the Name link) opens the quote
 * detail page, where every field is edited inline (no separate Edit action).
 * One ··· menu per row: Open and, with delete rights, Delete (confirmed in
 * `DeleteQuoteDialog`).
 */
export function QuotesTable({
  quotes,
  clientNameById,
  clientOptions,
  statusOptions,
  total,
  unfilteredTotal,
  page,
  showDraftBadge,
  canCreate,
  canDelete,
}: QuotesTableProps) {
  const [deletingQuote, setDeletingQuote] = useState<QuoteRecord | null>(null);

  const columns = useMemo<WebColumn<QuoteRecord>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        primary: true,
        sortable: true,
        render: (quote) => (
          <>
            {quote.name}
            {showDraftBadge && quote.is_auto_draft ? <StatusText tone="neutral"> · Concept</StatusText> : null}
          </>
        ),
      },
      { id: "client", header: "Client", render: (quote) => clientNameById.get(quote.client_id) ?? null },
      { id: "type", header: "Type", render: (quote) => (quote.quote_type === "contract" ? "Contract" : "Default") },
      {
        id: "status",
        header: "Status",
        render: (quote) =>
          quote.quote_status ? (
            <StatusText display="badge" tone={toneFromColor(quote.quote_status.color)}>{quote.quote_status.label}</StatusText>
          ) : null,
      },
      {
        id: "valid",
        header: "Valid until / period",
        sortable: true,
        render: (quote) =>
          quote.quote_type === "contract" && quote.contract_period_start && quote.contract_period_end
            ? `${formatDateWeb(quote.contract_period_start)} – ${formatDateWeb(quote.contract_period_end)}`
            : quote.valid_until
              ? formatDateWeb(quote.valid_until)
              : null,
      },
      { id: "total", header: "Total", align: "end", render: (quote) => formatMoneyWeb(quote.total) },
      { id: "created", header: "Created", sortable: true, render: (quote) => formatDateWeb(quote.created_at) },
    ],
    [clientNameById, showDraftBadge],
  );

  const dropdowns = useMemo(
    () => [
      { id: QUOTES_DROPDOWN_IDS.status, label: "Status", options: statusOptions },
      { id: QUOTES_DROPDOWN_IDS.type, label: "Type", options: QUOTE_TYPE_OPTIONS },
      { id: QUOTES_DROPDOWN_IDS.client, label: "Client", options: clientOptions },
    ],
    [statusOptions, clientOptions],
  );

  return (
    <>
      <WebDataTableCard<QuoteRecord>
        rows={quotes}
        getRowKey={(quote) => quote.id}
        columns={columns}
        noun="quotes"
        dropdowns={dropdowns}
        segment={QUOTES_OPEN_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: QUOTES_PAGE_SIZE }}
        defaultSort={{ columnId: "created", direction: "desc" }}
        rowHref={(quote) => `/quotes/${quote.id}`}
        rowLabel={(quote) => quote.name}
        rowActions={(quote) => [
          { key: "open", label: "Open", href: `/quotes/${quote.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeletingQuote(quote) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/quotes/new" className="web-rail-link">
              Create quote
            </Link>
          ) : null
        }
      />
      {deletingQuote ? (
        <DeleteQuoteDialog quote={deletingQuote} open onOpenChange={(next) => !next && setDeletingQuote(null)} />
      ) : null}
    </>
  );
}
