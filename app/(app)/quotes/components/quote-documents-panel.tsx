"use client";

import { useMemo } from "react";
import { WebBadge, WebButton, WebCard, WebDataTable } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import { InvoiceEmailStatusCell, PaymentStatusBadge } from "../../invoices/components/invoice-status";
import { downloadInvoiceUbl } from "../../invoices/components/ubl-download";
import type { InvoiceSummary } from "../invoice-actions";
import type { QuoteInvoiceFlow } from "./use-quote-invoice";

export interface QuoteDocumentsPanelProps {
  /** The live invoice (kind invoice, not credited); `null` = none yet, or the viewer cannot read invoices. */
  invoice: InvoiceSummary | null;
  /** Every invoice and credit note of the quote, newest first. */
  invoices: InvoiceSummary[];
  /** May the viewer generate the invoice now (has line items, invoicing right)? */
  canGenerate: boolean;
  canInvoice: boolean;
  flow: QuoteInvoiceFlow;
}

function emailState(row: InvoiceSummary): "sent" | "failed" | "not_sent" {
  if (row.emailError) return "failed";
  return row.emailedAt ? "sent" : "not_sent";
}

const isLive = (row: InvoiceSummary) => row.kind === "invoice" && !row.creditedAt;

/**
 * Documents tab of the Quote page: every invoice and credit note generated
 * from this quote (issues #119, #235, #236), each with its payment-status badge
 * and e-mail status, plus Open PDF / Send / Resend and, in the ··· menu,
 * Register payment and Credit invoice. Invoices that carry payments (or can
 * still receive them) get a Payments card underneath. "Generate invoice" is
 * available whenever there is no live invoice (also after a credit). Same
 * `useQuoteInvoice` flow (confirm dialogs, popups, server actions) as the
 * LivePanel.
 */
export function QuoteDocumentsPanel({ invoice, invoices, canGenerate, canInvoice, flow }: QuoteDocumentsPanelProps) {
  const columns = useMemo<WebColumn<InvoiceSummary>[]>(
    () => [
      {
        id: "number",
        header: "Document",
        primary: true,
        mono: true,
        render: (row) => (
          <>
            {row.invoiceNumber}
            {row.kind === "credit_note" ? (
              <>
                {" "}
                <WebBadge variant="mono">Credit note</WebBadge>
                {row.creditsInvoiceNumber ? <span className="web-muted-cell"> for {row.creditsInvoiceNumber}</span> : null}
              </>
            ) : null}
          </>
        ),
      },
      { id: "date", header: "Date", sortValue: (row) => row.invoiceDate, render: (row) => formatDateWeb(row.invoiceDate) },
      {
        id: "due",
        header: "Due date",
        sortValue: (row) => row.dueDate,
        render: (row) => (row.kind === "credit_note" ? null : formatDateWeb(row.dueDate)),
      },
      { id: "total", header: "Total incl. VAT", align: "end", sortValue: (row) => row.total, render: (row) => formatMoneyWeb(row.total) },
      { id: "status", header: "Status", render: (row) => <PaymentStatusBadge status={row.paymentStatus} /> },
      {
        id: "sent",
        header: "E-mail",
        render: (row) => (
          <InvoiceEmailStatusCell status={emailState(row)} error={row.emailError} to={row.emailedTo} at={row.emailedAt} outbox={row.outbox} />
        ),
      },
      {
        id: "actions",
        header: "",
        align: "end",
        render: (row) => (
          <>
            <WebButton size="sm" onClick={() => flow.openPdfFor(row.id)}>
              Open PDF
            </WebButton>
            <WebButton size="sm" onClick={() => void downloadInvoiceUbl(row.id, row.invoiceNumber)}>
              UBL (XML)
            </WebButton>
            {canInvoice ? (
              <WebButton
                size="sm"
                loading={flow.sending}
                onClick={() => (row.emailedAt ? flow.requestResendFor(row) : flow.sendFor(row.id))}
              >
                {row.emailedAt ? "Resend…" : "Send"}
              </WebButton>
            ) : null}
          </>
        ),
      },
    ],
    [flow, canInvoice],
  );

  function rowActions(row: InvoiceSummary): WebMenuItem[] {
    if (!canInvoice || !isLive(row)) return [];
    const items: WebMenuItem[] = [];
    if (row.outstanding > 0) {
      items.push({ key: "pay", label: "Register payment…", onSelect: () => flow.requestPayment(row) });
    }
    items.push({ key: "credit", label: "Credit invoice…", danger: true, onSelect: () => flow.requestCredit(row) });
    return items;
  }

  const generateButton =
    !invoice && canGenerate ? (
      <WebButton variant="primary" loading={flow.generating} onClick={flow.requestGenerate}>
        Generate invoice
      </WebButton>
    ) : undefined;

  // Payment cards: invoices that have payments, plus the live invoice (to register the first one).
  const paymentCards = invoices.filter((row) => row.kind === "invoice" && (row.payments.length > 0 || isLive(row)));

  return (
    <>
      <WebDataTableCard
        title="Invoices"
        meta={String(invoices.length)}
        rows={invoices}
        getRowKey={(row) => row.id}
        columns={columns}
        noun="invoices"
        dropdowns={[]}
        segment={{
          label: "Show documents",
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
        rowActions={canInvoice ? rowActions : undefined}
        rowLabel={(row) => `${row.kind === "credit_note" ? "Credit note" : "Invoice"} ${row.invoiceNumber}`}
      />

      {paymentCards.map((row) => (
        <WebCard
          key={row.id}
          title={`Payments on ${row.invoiceNumber}`}
          meta={`${formatMoneyWeb(row.paidAmount)} of ${formatMoneyWeb(row.total)} paid`}
          action={
            canInvoice && isLive(row) && row.outstanding > 0 ? (
              <WebButton size="sm" onClick={() => flow.requestPayment(row)}>
                Register payment
              </WebButton>
            ) : undefined
          }
        >
          {row.payments.length === 0 ? (
            <p className="web-rail-empty">No payments registered yet.</p>
          ) : (
            <WebDataTable>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" data-numeric="true">
                    Amount
                  </th>
                  <th scope="col">Method</th>
                  <th scope="col">Note</th>
                  <th scope="col">Registered by</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {row.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDateWeb(payment.paidOn)}</td>
                    <td data-numeric="true">{formatMoneyWeb(payment.amount)}</td>
                    <td>{payment.methodLabel}</td>
                    <td>{payment.note}</td>
                    <td>{payment.createdByName}</td>
                    <td data-numeric="true">
                      {canInvoice && payment.canDelete ? (
                        <WebButton
                          size="sm"
                          variant="danger"
                          aria-label={`Delete payment of ${formatMoneyWeb(payment.amount)} on ${formatDateWeb(payment.paidOn)} (${row.invoiceNumber})`}
                          onClick={() => flow.requestDeletePayment(payment, row.invoiceNumber)}
                        >
                          Delete
                        </WebButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </WebDataTable>
          )}
        </WebCard>
      ))}
    </>
  );
}
