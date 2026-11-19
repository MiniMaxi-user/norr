"use client";

import { useMemo } from "react";
import { WebBadge, WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateTimeWeb, formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { InvoiceSummary } from "../invoice-actions";
import type { QuoteInvoiceFlow } from "./use-quote-invoice";

export interface QuoteDocumentsPanelProps {
  /** `null` = no invoice yet, or the viewer cannot read invoices. */
  invoice: InvoiceSummary | null;
  /** May the viewer generate the invoice now (has line items, invoicing right)? */
  canGenerate: boolean;
  canInvoice: boolean;
  flow: QuoteInvoiceFlow;
}

/**
 * Documents tab of the Quote page: the documents generated from this quote
 * (today: its invoice), with the actions that used to live in the header's
 * ··· menu — Generate invoice, Open PDF, Send / Resend. Same `useQuoteInvoice`
 * flow (confirm dialogs, server actions) as the LivePanel.
 */
export function QuoteDocumentsPanel({ invoice, canGenerate, canInvoice, flow }: QuoteDocumentsPanelProps) {
  const rows = useMemo(() => (invoice ? [invoice] : []), [invoice]);

  const columns = useMemo<WebColumn<InvoiceSummary>[]>(
    () => [
      { id: "number", header: "Invoice", primary: true, mono: true, render: (row) => row.invoiceNumber },
      { id: "date", header: "Invoice date", sortValue: (row) => row.invoiceDate, render: (row) => formatDateWeb(row.invoiceDate) },
      { id: "due", header: "Due date", sortValue: (row) => row.dueDate, render: (row) => formatDateWeb(row.dueDate) },
      { id: "total", header: "Total incl. VAT", align: "end", sortValue: (row) => row.total, render: (row) => formatMoneyWeb(row.total) },
      {
        id: "sent",
        header: "Sent",
        render: (row) => {
          if (row.emailError) {
            return (
              <>
                <WebBadge variant="danger">Failed</WebBadge> {row.emailError}
              </>
            );
          }
          if (!row.emailedAt) return "Not sent";
          return `${row.emailedTo ?? ""} · ${formatDateTimeWeb(row.emailedAt)}`;
        },
      },
      {
        id: "actions",
        header: "",
        align: "end",
        render: () => (
          <>
            <WebButton size="sm" onClick={flow.openPdf}>
              Open PDF
            </WebButton>
            {canInvoice ? (
              <WebButton
                size="sm"
                loading={flow.sending}
                onClick={invoice?.emailedAt ? flow.requestResend : flow.sendNow}
              >
                {invoice?.emailedAt ? "Resend…" : "Send"}
              </WebButton>
            ) : null}
          </>
        ),
      },
    ],
    [flow, canInvoice, invoice?.emailedAt],
  );

  const generateButton =
    !invoice && canGenerate ? (
      <WebButton variant="primary" loading={flow.generating} onClick={flow.requestGenerate}>
        Generate invoice
      </WebButton>
    ) : undefined;

  return (
    <WebDataTableCard
      title="Invoices"
      meta={String(rows.length)}
      rows={rows}
      getRowKey={(row) => row.id}
      columns={columns}
      noun="invoices"
      dropdowns={[]}
      segment={{
        label: "Show invoices",
        defaultValue: "all",
        options: [
          { value: "sent", label: "Sent", match: (row: InvoiceSummary) => Boolean(row.emailedAt) && !row.emailError },
          { value: "unsent", label: "Not sent", match: (row: InvoiceSummary) => !row.emailedAt || Boolean(row.emailError) },
          { value: "all", label: "All" },
        ] as const,
      }}
      urlPrefix="documents"
      add={generateButton}
      emptyAction={generateButton}
      rowLabel={(row) => `Invoice ${row.invoiceNumber}`}
    />
  );
}
