"use client";

import { SidebarNotice, SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import { formatDateTimeWeb, formatMoneyWeb } from "@/lib/format/web";
import type { InvoiceSummary } from "../invoice-actions";
import { pluralDays } from "./quote-status";
import type { QuoteTotals } from "./quote-totals";

export interface QuoteRailProps {
  /** From `getLivePanel`; `null` most of the time. Always the first section. */
  livePanel: LivePanelData | null;
  /** Days left on an open quote's validity (negative once past); `null` = not applicable. */
  validityDaysLeft: number | null;
  lineCount: number;
  totals: QuoteTotals;
  /** `null` = no invoice yet, or the viewer cannot read invoices. */
  invoice: InvoiceSummary | null;
  onShowLineItems: () => void;
}

/**
 * Right rail of the Quote page (design system, issue #222): [LivePanel] ·
 * Validity (time left on an open quote) · Totals (lines, subtotal, VAT, total
 * incl. VAT — the table itself carries no totals row) · Invoice (number, when
 * generated, e-mail outcome — only once invoiced) — only facts the Overview
 * "Details" card does not already show — above the always-last TIMELINE
 * (added by `WebDetailLayout`). Read-only.
 */
export function QuoteRail({ livePanel, validityDaysLeft, lineCount, totals, invoice, onShowLineItems }: QuoteRailProps) {
  let validity: string | null = null;
  if (validityDaysLeft !== null) {
    if (validityDaysLeft > 0) validity = `${pluralDays(validityDaysLeft)} left`;
    else if (validityDaysLeft === 0) validity = "Expires today";
    else validity = `Expired ${pluralDays(-validityDaysLeft)} ago`;
  }

  let emailOutcome: string;
  if (invoice?.emailedTo) {
    emailOutcome = `Sent to ${invoice.emailedTo}${invoice.emailedAt ? ` on ${formatDateTimeWeb(invoice.emailedAt)}` : ""}`;
  } else if (invoice?.emailError) {
    emailOutcome = `Failed: ${invoice.emailError}`;
  } else {
    emailOutcome = "Not sent";
  }

  return (
    <>
      <LivePanel panel={livePanel} />

      {validity ? (
        <SidebarSection title="Validity">
          <SidebarRows rows={[{ label: "Remaining", value: validity }]} />
        </SidebarSection>
      ) : null}

      <SidebarSection title="Totals">
        <SidebarRows
          rows={[
            {
              label: "Line items",
              value:
                lineCount > 0 ? (
                  <button type="button" className="web-rail-link" onClick={onShowLineItems}>
                    {lineCount}
                  </button>
                ) : (
                  "None"
                ),
            },
            { label: "Subtotal", value: formatMoneyWeb(totals.subtotal) },
            { label: "VAT", value: formatMoneyWeb(totals.vat) },
            { label: "Total incl. VAT", value: <strong>{formatMoneyWeb(totals.total)}</strong> },
          ]}
        />
        {totals.linesWithoutVat > 0 && lineCount > 0 ? (
          <SidebarNotice>
            {totals.linesWithoutVat === 1 ? "1 line has" : `${totals.linesWithoutVat} lines have`} no VAT rate (no
            linked article), so no VAT is counted for {totals.linesWithoutVat === 1 ? "it" : "them"}.
          </SidebarNotice>
        ) : null}
      </SidebarSection>

      {invoice ? (
        <SidebarSection title="Invoice">
          <SidebarRows
            rows={[
              { label: "Number", value: invoice.invoiceNumber },
              { label: "Generated", value: formatDateTimeWeb(invoice.generatedAt) },
              { label: "Email", value: emailOutcome },
            ]}
          />
        </SidebarSection>
      ) : null}
    </>
  );
}
