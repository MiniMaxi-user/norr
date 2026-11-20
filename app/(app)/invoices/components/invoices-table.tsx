"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { WebBadge } from "@yourorg/ui/web";
import { WebDataTableCard, type FilterOption, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import { openDocumentPopup } from "@/lib/popup";
import type { InvoiceListRow } from "../actions";
import { CreditInvoiceDialog } from "./credit-invoice-dialog";
import { InvoiceEmailStatusCell, PAYMENT_STATUS_META, PAYMENT_STATUS_OPTIONS, PaymentStatusBadge } from "./invoice-status";
import {
  INVOICE_PERIOD_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  INVOICES_DROPDOWN_IDS,
  INVOICES_PAGE_SIZE,
  INVOICES_SEGMENT,
  UNPAID_STATUSES,
} from "./invoices-query";
import { RegisterPaymentDialog } from "./register-payment-dialog";

export interface InvoicesTableProps {
  invoices: InvoiceListRow[];
  /** Server mode (the /invoices page): filtering, sorting and paging happen in
   * `listInvoices` from the URL params. Client mode (a client's Invoices tab):
   * `rows` is the whole list and the card filters it itself. */
  server?: { total: number; unfilteredTotal?: number; page: number; clientOptions: FilterOption[] };
  /** Hides the Client column (the client's own tab). */
  hideClient?: boolean;
  /** URL-param namespace in client mode. */
  urlPrefix?: string;
}

const isUnpaid = (row: InvoiceListRow) => UNPAID_STATUSES.includes(row.paymentStatus);

/**
 * Invoices list table (issues #234-#236), used by `/invoices` and the client's
 * Invoices tab. A row opens the invoice/credit-note PDF in a popup
 * (`lib/popup.ts`, like the quote page); the ··· menu offers Open PDF,
 * Register payment and Credit invoice when the row allows them.
 */
export function InvoicesTable({ invoices, server, hideClient, urlPrefix = "invoices" }: InvoicesTableProps) {
  const [paying, setPaying] = useState<InvoiceListRow | null>(null);
  const [crediting, setCrediting] = useState<InvoiceListRow | null>(null);

  const columns = useMemo<WebColumn<InvoiceListRow>[]>(() => {
    const cols: WebColumn<InvoiceListRow>[] = [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.invoiceNumber,
        render: (row) => (
          <>
            {row.invoiceNumber}
            {row.kind === "credit_note" ? (
              <>
                {" "}
                <WebBadge variant="mono">Credit note</WebBadge>
              </>
            ) : null}
          </>
        ),
      },
      {
        id: "date",
        header: "Invoice date",
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.invoiceDate,
        render: (row) => formatDateWeb(row.invoiceDate),
      },
    ];
    if (!hideClient) {
      cols.push({
        id: "client",
        header: "Client",
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.clientName ?? "",
        render: (row) => (row.clientId && row.clientName ? <Link href={`/clients/${row.clientId}`}>{row.clientName}</Link> : null),
      });
    }
    cols.push(
      {
        id: "source",
        header: "Quote / contract",
        render: (row) =>
          row.quoteType === "contract" && row.contractId ? (
            <Link href={`/contracts/${row.contractId}`}>{row.contractNumber ?? "Contract"}</Link>
          ) : (
            <Link href={`/quotes/${row.quoteId}`}>{row.quoteNumber ?? "Quote"}</Link>
          ),
      },
      {
        id: "subtotal",
        header: "Excl. VAT",
        align: "end",
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.subtotal,
        render: (row) => formatMoneyWeb(row.subtotal),
      },
      {
        id: "total",
        header: "Incl. VAT",
        align: "end",
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.total,
        render: (row) => formatMoneyWeb(row.total),
      },
      {
        id: "due",
        header: "Due date",
        sortable: Boolean(server),
        sortValue: server ? undefined : (row) => row.dueDate,
        render: (row) => (row.kind === "credit_note" ? null : formatDateWeb(row.dueDate)),
      },
      { id: "status", header: "Status", render: (row) => <PaymentStatusBadge status={row.paymentStatus} /> },
      {
        id: "email",
        header: "E-mail",
        render: (row) => (
          <InvoiceEmailStatusCell status={row.emailStatus} error={row.emailError} to={row.emailedTo} at={row.emailedAt} outbox={row.outbox} />
        ),
      },
    );
    return cols;
  }, [server, hideClient]);

  const dropdowns = useMemo(() => {
    if (server) {
      return [
        { id: INVOICES_DROPDOWN_IDS.period, label: "Period", options: INVOICE_PERIOD_OPTIONS },
        { id: INVOICES_DROPDOWN_IDS.status, label: "Status", options: PAYMENT_STATUS_OPTIONS, multiple: true },
        { id: INVOICES_DROPDOWN_IDS.type, label: "Type", options: INVOICE_TYPE_OPTIONS },
        { id: INVOICES_DROPDOWN_IDS.client, label: "Client", options: server.clientOptions },
      ];
    }
    return [
      {
        id: "status",
        label: "Status",
        getOptions: (row: InvoiceListRow) => [
          { value: row.paymentStatus, label: PAYMENT_STATUS_META[row.paymentStatus].label },
        ],
      },
      {
        id: "type",
        label: "Type",
        getOptions: (row: InvoiceListRow) => [
          row.quoteType === "contract" ? INVOICE_TYPE_OPTIONS[1]! : INVOICE_TYPE_OPTIONS[0]!,
        ],
      },
    ];
  }, [server]);

  const segment = useMemo(
    () =>
      server
        ? INVOICES_SEGMENT
        : {
            ...INVOICES_SEGMENT,
            options: [
              { ...INVOICES_SEGMENT.options[0], match: isUnpaid },
              { ...INVOICES_SEGMENT.options[1], match: (row: InvoiceListRow) => !isUnpaid(row) },
              INVOICES_SEGMENT.options[2],
            ] as const,
          },
    [server],
  );

  function rowActions(row: InvoiceListRow): WebMenuItem[] {
    const items: WebMenuItem[] = [
      { key: "pdf", label: "Open PDF", onSelect: () => openDocumentPopup(`/invoices/${row.id}/pdf`, "invoice PDF") },
      { key: "quote", label: "Open quote", href: `/quotes/${row.quoteId}` },
    ];
    if (row.canRegisterPayment || row.canCredit) items.push({ type: "separator", key: "sep" });
    if (row.canRegisterPayment) {
      items.push({ key: "pay", label: "Register payment…", onSelect: () => setPaying(row) });
    }
    if (row.canCredit) {
      items.push({ key: "credit", label: "Credit invoice…", danger: true, onSelect: () => setCrediting(row) });
    }
    return items;
  }

  return (
    <>
      <WebDataTableCard<InvoiceListRow>
        rows={invoices}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.invoiceNumber} ${row.clientName ?? ""} ${row.quoteNumber ?? ""}`}
        noun="invoices"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix={urlPrefix}
        title={server ? undefined : "Invoices"}
        meta={server ? undefined : String(invoices.length)}
        server={server ? { ...server, pageSize: INVOICES_PAGE_SIZE } : undefined}
        defaultSort={{ columnId: "date", direction: "desc" }}
        onRowClick={(row) => openDocumentPopup(`/invoices/${row.id}/pdf`, "invoice PDF")}
        rowActions={rowActions}
        rowLabel={(row) => row.invoiceNumber}
        emptyAction={null}
      />
      {paying ? (
        <RegisterPaymentDialog
          invoice={{ id: paying.id, invoiceNumber: paying.invoiceNumber, outstanding: paying.outstanding }}
          open
          onOpenChange={(next) => !next && setPaying(null)}
        />
      ) : null}
      {crediting ? (
        <CreditInvoiceDialog
          invoice={{ id: crediting.id, invoiceNumber: crediting.invoiceNumber, isContract: crediting.quoteType === "contract" }}
          open
          onOpenChange={(next) => !next && setCrediting(null)}
        />
      ) : null}
    </>
  );
}
