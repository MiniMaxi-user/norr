"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Checkbox } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { StatusText, WebDataTableCard, toneFromColor, type FilterOption, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { QuoteRecord } from "../actions";
import { BatchInvoiceDialog } from "./batch-invoice-dialog";
import { NOT_INVOICEABLE } from "./quote-live-panel";
import { MAX_BATCH_INVOICE_QUOTES } from "../invoice-batch";
import { DeleteQuoteDialog } from "./delete-quote-dialog";
import { QUOTE_TYPE_OPTIONS, QUOTES_DROPDOWN_IDS, QUOTES_OPEN_SEGMENT, QUOTES_PAGE_SIZE } from "./quotes-query";

/** Client reference cell: a link in `text-link` (DS: clickable = coloured). */
function clientLink(clientId: string | null | undefined, name: string | undefined) {
  return clientId && name ? <Link href={`/clients/${clientId}`}>{name}</Link> : null;
}

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
  /** `can(actor, "invoicing", "create")` and the invoicing feature: shows the row checkboxes + "Invoice selected". */
  canInvoice?: boolean;
}

/** Issue #237: same rule as the Quote page's "Generate invoice" (`NOT_INVOICEABLE`), minus work-order auto-drafts. */
function invoiceableReason(quote: QuoteRecord): string | null {
  const status = quote.quote_status?.value ?? "";
  if (quote.is_auto_draft) return "Work order auto-drafts cannot be invoiced";
  if (NOT_INVOICEABLE.includes(status)) return `A ${quote.quote_status?.label ?? status} quote cannot be invoiced`;
  return null;
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
  canInvoice = false,
}: QuotesTableProps) {
  const [deletingQuote, setDeletingQuote] = useState<QuoteRecord | null>(null);
  // Selected quote id -> total (kept across pages so the confirmation can sum them).
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [batchOpen, setBatchOpen] = useState(false);

  const invoiceableOnPage = useMemo(() => quotes.filter((quote) => invoiceableReason(quote) === null), [quotes]);
  const allOnPageSelected = invoiceableOnPage.length > 0 && invoiceableOnPage.every((quote) => selected.has(quote.id));
  const overLimit = selected.size > MAX_BATCH_INVOICE_QUOTES;

  function toggleQuote(quote: QuoteRecord, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(quote.id, quote.total);
      else next.delete(quote.id);
      return next;
    });
  }

  function toggleAllOnPage(checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      for (const quote of invoiceableOnPage) {
        if (checked) next.set(quote.id, quote.total);
        else next.delete(quote.id);
      }
      return next;
    });
  }

  const columns = useMemo<WebColumn<QuoteRecord>[]>(
    () => [
      ...(canInvoice
        ? [
            {
              id: "select",
              header: "",
              render: (quote: QuoteRecord) => {
                const reason = invoiceableReason(quote);
                return (
                  <Checkbox
                    checked={selected.has(quote.id)}
                    disabled={reason !== null}
                    title={reason ?? undefined}
                    aria-label={`Select ${quote.quote_number}`}
                    onChange={(event) => toggleQuote(quote, event.target.checked)}
                  />
                );
              },
            },
          ]
        : []),
      { id: "number", header: "Number", primary: true, mono: true, sortable: true, render: (quote) => quote.quote_number },
      {
        id: "name",
        header: "Name",
        sortable: true,
        render: (quote) => (
          <>
            {quote.name}
            {showDraftBadge && quote.is_auto_draft ? <>{" "}<StatusText display="auto">Concept</StatusText></> : null}
          </>
        ),
      },
      { id: "client", header: "Client", render: (quote) => clientLink(quote.client_id, clientNameById.get(quote.client_id)) },
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
    [clientNameById, showDraftBadge, canInvoice, selected],
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
        rowLabel={(quote) => quote.quote_number}
        rowActions={(quote) => [
          { key: "open", label: "Open", href: `/quotes/${quote.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeletingQuote(quote) },
              ]
            : []),
        ]}
        note={
          canInvoice && invoiceableOnPage.length > 0 ? (
            <label>
              <Checkbox checked={allOnPageSelected} onChange={(event) => toggleAllOnPage(event.target.checked)} /> Select
              all invoiceable quotes on this page
            </label>
          ) : undefined
        }
        add={
          canInvoice && selected.size > 0 ? (
            <>
              <WebButton onClick={() => setSelected(new Map())}>Clear selection</WebButton>
              <WebButton variant="primary" disabled={overLimit} onClick={() => setBatchOpen(true)}>
                {`Invoice selected (${selected.size})`}
              </WebButton>
              {overLimit ? <span>{`Select at most ${MAX_BATCH_INVOICE_QUOTES} quotes.`}</span> : null}
            </>
          ) : undefined
        }
        emptyAction={
          canCreate ? (
            <Link href="/quotes/new" className="web-rail-link">
              Create quote
            </Link>
          ) : null
        }
      />
      {batchOpen ? (
        <BatchInvoiceDialog
          quoteIds={[...selected.keys()]}
          totalAmount={[...selected.values()].reduce((sum, value) => sum + value, 0)}
          onOpenChange={setBatchOpen}
          onFinished={() => setSelected(new Map())}
        />
      ) : null}
      {deletingQuote ? (
        <DeleteQuoteDialog quote={deletingQuote} open onOpenChange={(next) => !next && setDeletingQuote(null)} />
      ) : null}
    </>
  );
}
