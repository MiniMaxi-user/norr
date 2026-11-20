"use client";

import { useMemo } from "react";
import Link from "next/link";
import { WebBadge } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import { OutboxStatusBadge } from "@/components/email/outbox-status-badge";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { OutboxItem } from "./actions";

export interface OutboxTableProps {
  items: OutboxItem[];
  /** Mails still queued or sending (all time). */
  pendingCount: number;
  days: number;
  loadError?: string;
}

const KIND_LABEL: Record<OutboxItem["kind"], string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  work_receipt: "Work receipt",
};

const STATUS_LABEL: Record<OutboxItem["status"], string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

function sourceOf(item: OutboxItem): { label: string; href: string | null } {
  const { source } = item;
  if (item.kind === "work_receipt") {
    return {
      label: source.receiptNumber ?? "Work receipt",
      href: source.workOrderId ? `/work-orders/${source.workOrderId}` : null,
    };
  }
  return {
    label: source.invoiceNumber ?? KIND_LABEL[item.kind],
    href: source.quoteId ? `/quotes/${source.quoteId}` : null,
  };
}

/**
 * Settings -> Outbox table (issue #268): status filter as a dropdown
 * (URL-persisted), per failed mail a Retry in the shared status badge.
 */
export function OutboxTable({ items, pendingCount, days, loadError }: OutboxTableProps) {
  const columns = useMemo<WebColumn<OutboxItem>[]>(
    () => [
      { id: "status", header: "Status", render: (row) => <OutboxStatusBadge mail={{ ...row, outboxId: row.id }} /> },
      { id: "kind", header: "Type", render: (row) => <WebBadge variant="mono">{KIND_LABEL[row.kind]}</WebBadge> },
      { id: "to", header: "Recipient", sortValue: (row) => row.to.join(", "), render: (row) => row.to.join(", ") },
      { id: "subject", header: "Subject", primary: true, sortValue: (row) => row.subject, render: (row) => row.subject },
      { id: "queued", header: "Queued", sortValue: (row) => row.queuedAt, render: (row) => formatDateTimeWeb(row.queuedAt) },
      {
        id: "sent",
        header: "Sent",
        sortValue: (row) => row.sentAt ?? "",
        render: (row) => (row.sentAt ? formatDateTimeWeb(row.sentAt) : null),
      },
      {
        id: "source",
        header: "Record",
        render: (row) => {
          const { label, href } = sourceOf(row);
          return href ? <Link href={href}>{label}</Link> : label;
        },
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        getOptions: (row: OutboxItem) => [{ value: row.status, label: STATUS_LABEL[row.status] }],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show e-mails",
      defaultValue: "all",
      options: [
        { value: "queue", label: "In queue", match: (row: OutboxItem) => row.status === "queued" || row.status === "sending" },
        { value: "failed", label: "Failed", match: (row: OutboxItem) => row.status === "failed" },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}
      <WebDataTableCard
        title="Outbox"
        meta={`${pendingCount} in queue`}
        note={`Invoice, credit note and work receipt e-mails of the last ${days} days. Mails are sent in the background within the provider's limits.`}
        rows={items}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.subject} ${row.to.join(" ")} ${row.source.invoiceNumber ?? ""} ${row.source.receiptNumber ?? ""}`}
        noun="e-mails"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="outbox"
        defaultSort={{ columnId: "queued", direction: "desc" }}
        rowLabel={(row) => row.subject}
      />
    </div>
  );
}
