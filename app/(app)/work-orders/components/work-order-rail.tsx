"use client";

import { SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { formatDateTimeWeb, formatDateWeb } from "@/lib/format/web";

/** The invoiced quote of this work order (issue #233). `invoiceNumber` /
 * `invoicedAt` are `null` for a viewer who may not read invoices (only owner
 * and administratie may); the quote link is still shown. */
export interface WorkOrderInvoiceInfo {
  quoteId: string;
  quoteName: string | null;
  invoiceNumber: string | null;
  invoicedAt: string | null;
}

export interface WorkOrderRailProps {
  /** From `getLivePanel`; `null` most of the time. Always the first section. */
  livePanel: LivePanelData | null;
  /** The linked asset's record, for the Object section. */
  assetRecord: AssetRecord | null;
  /** Set once the work order is Invoiced (issue #233). */
  invoice?: WorkOrderInvoiceInfo | null;
  /** Set when automatic work receipt e-mail is on but the site has no Work receipt
   * contact with an e-mail (issue #273): a calm notice linking to the client's Sites tab. */
  missingReceiptRecipient?: { clientId: string } | null;
}

/**
 * Right rail of the Work order page (design system, issue #222): [LivePanel] ·
 * Object (what the asset is — only facts that exist on its record) · Invoice
 * (only once Invoiced, issue #233: the quote and invoice number, linking to
 * the quote's Documents tab) · TIMELINE (added by `WebDetailLayout`). Read-only.
 *
 * No Context section: client, site, asset, contract and source activity are
 * already the right-hand column of the Overview "Details" card, and the rail
 * must not repeat what the centre shows (DS 01 §4). There is no documents
 * concept on a work order yet, so no Documents section either.
 */
export function WorkOrderRail({ livePanel, assetRecord, invoice = null, missingReceiptRecipient = null }: WorkOrderRailProps) {
  const typeText = assetRecord
    ? [assetRecord.asset_type?.label, assetRecord.asset_subtype?.label].filter(Boolean).join(" / ")
    : "";
  const installedYear = assetRecord?.installed_at ? assetRecord.installed_at.slice(0, 4) : null;
  const objectRows = assetRecord
    ? [
        { label: "Type", value: typeText || "—" },
        { label: "Model", value: assetRecord.asset_model?.name ?? "—" },
        { label: "Serial number", value: assetRecord.serial_number ?? "—" },
        { label: "Installed", value: installedYear ?? "—" },
        { label: "Status", value: assetRecord.asset_status?.label ?? "—" },
        ...(assetRecord.warranty_until ? [{ label: "Warranty until", value: formatDateWeb(assetRecord.warranty_until) }] : []),
      ]
    : [];

  return (
    <>
      <LivePanel panel={livePanel} />

      {missingReceiptRecipient ? (
        <SidebarSection title="Work receipt" link={{ label: "Open sites", href: `/clients/${missingReceiptRecipient.clientId}?tab=sites` }}>
          <p className="web-rail-empty">No work receipt recipient set for this site</p>
        </SidebarSection>
      ) : null}

      {assetRecord ? (
        <SidebarSection title="Object" link={{ label: "Open asset", href: `/assets/${assetRecord.id}` }}>
          <SidebarRows rows={objectRows} />
        </SidebarSection>
      ) : null}

      {invoice ? (
        <SidebarSection title="Invoice" link={{ label: "Open quote", href: `/quotes/${invoice.quoteId}?tab=documents` }}>
          <SidebarRows
            rows={[
              { label: "Quote", value: invoice.quoteName || "Quote" },
              ...(invoice.invoiceNumber ? [{ label: "Invoice", value: invoice.invoiceNumber }] : []),
              ...(invoice.invoicedAt ? [{ label: "Invoiced", value: formatDateTimeWeb(invoice.invoicedAt) }] : []),
            ]}
          />
        </SidebarSection>
      ) : null}
    </>
  );
}
