"use client";

import type { InvoiceListRow } from "@/app/(app)/invoices/actions";
import { InvoicesTable } from "@/app/(app)/invoices/components/invoices-table";

export interface InvoicesPanelProps {
  invoices: InvoiceListRow[];
}

/**
 * Invoices tab (issues #234-#236; docs/ARCHITECTURE.md "Relational detail
 * pages") — the invoices overview table filtered to this client: payment-status
 * badges, PDF popup on row click, Register payment / Credit invoice in the ···
 * menu. Only mounted when the tenant has `invoicing` and the viewer may read it.
 */
export function InvoicesPanel({ invoices }: InvoicesPanelProps) {
  return <InvoicesTable invoices={invoices} hideClient urlPrefix="invoices" />;
}
