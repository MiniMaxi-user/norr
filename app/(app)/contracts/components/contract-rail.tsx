"use client";

import { SidebarNotice, SidebarProgress, SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import { getContractStatus, pluralDays } from "./contract-status";

export interface ContractRailProps {
  /** From `getLivePanel`; `null` most of the time. Always the first section. */
  livePanel: LivePanelData | null;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  /** DB-computed next invoice date (`null` = fully invoiced / not billed). */
  nextInvoiceDate: string | null;
  /** Billing cadence from the billing terms ("Every 3 months"). */
  cadence: string | null;
  invoicedPeriodCount: number;
  /** Active contracts with counter lines (issue #271): when the next counter settlement is due. */
  settlement?: { nextSettlementDate: string | null; currentWindow: { start: string; end: string } | null } | null;
  lineItemCount: number;
  lineItemTotal: number;
  /** Assets linked to the contract and how many distinct sites they sit on. */
  coveredAssetCount: number;
  coveredSiteCount: number;
  onShowLineItems: () => void;
  onShowAssets: () => void;
  now?: number;
}

const ENDING_SOON_DAYS = 90;

function todayIso(now: number) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Right rail of the Contract page (design system, issue #222): [LivePanel] ·
 * Term (time remaining with a progress bar) · Invoicing (next invoice date,
 * cadence, periods invoiced) · Contents (line item total, covered assets) —
 * only facts the Overview "Details" card does not already show (it carries
 * the dates, value, billing terms and period themselves) — above the
 * always-last TIMELINE (added by `WebDetailLayout`). Read-only.
 */
export function ContractRail({
  livePanel,
  startDate,
  endDate,
  autoRenew,
  nextInvoiceDate,
  cadence,
  invoicedPeriodCount,
  settlement = null,
  lineItemCount,
  lineItemTotal,
  coveredAssetCount,
  coveredSiteCount,
  onShowLineItems,
  onShowAssets,
  now = Date.now(),
}: ContractRailProps) {
  const status = getContractStatus({ start_date: startDate, end_date: endDate }, now);
  const start = new Date(`${startDate}T00:00:00`).getTime();
  // The end date is the last covered day, so the term runs until the end of that day.
  const end = endDate ? new Date(`${endDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : NaN;
  const hasEnd = !Number.isNaN(end);

  let remaining: string;
  if (status.phase === "upcoming") remaining = `Starts in ${pluralDays(status.daysToStart)}`;
  else if (status.daysToEnd === null) remaining = "Open-ended";
  else if (status.daysToEnd < 0) remaining = "Ended";
  else remaining = pluralDays(status.daysToEnd);

  // Share of the term that has elapsed: start -> now, out of start -> end.
  const progress =
    hasEnd && end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : null;
  const endingSoon = status.phase === "active" && status.daysToEnd !== null && status.daysToEnd <= ENDING_SOON_DAYS;
  const isDue = nextInvoiceDate !== null && nextInvoiceDate <= todayIso(now);

  return (
    <>
      <LivePanel panel={livePanel} />

      <SidebarSection title="Term">
        <SidebarRows
          rows={[
            { label: "Remaining", value: remaining },
            ...(endDate ? [{ label: "Renewal", value: autoRenew ? "Renews automatically" : "Ends on the end date" }] : []),
          ]}
        />
        {progress !== null && status.phase !== "upcoming" ? (
          <SidebarProgress
            value={progress}
            label="Term elapsed"
            tone={status.phase === "ended" ? "danger" : endingSoon && !autoRenew ? "warning" : "success"}
          />
        ) : null}
      </SidebarSection>

      <SidebarSection title="Invoicing">
        <SidebarRows
          rows={[
            { label: "Next invoice", value: nextInvoiceDate ? formatDateWeb(nextInvoiceDate) : "Fully invoiced" },
            { label: "Cadence", value: cadence ?? "—" },
            { label: "Periods invoiced", value: String(invoicedPeriodCount) },
            ...(settlement
              ? [
                  {
                    label: "Next settlement",
                    value: settlement.nextSettlementDate ? formatDateWeb(settlement.nextSettlementDate) : "None planned",
                  },
                  {
                    label: "Settlement window",
                    value: settlement.currentWindow
                      ? `${formatDateWeb(settlement.currentWindow.start)} – ${formatDateWeb(settlement.currentWindow.end)}`
                      : "—",
                  },
                ]
              : []),
          ]}
        />
        {isDue ? <SidebarNotice>An invoice is due for this contract.</SidebarNotice> : null}
      </SidebarSection>

      <SidebarSection title="Contents">
        <SidebarRows
          rows={[
            {
              label: "Line items",
              value:
                lineItemCount > 0 ? (
                  <button type="button" className="web-rail-link" onClick={onShowLineItems}>
                    {formatMoneyWeb(lineItemTotal)}
                  </button>
                ) : (
                  "None"
                ),
            },
            {
              label: "Covered assets",
              value:
                coveredAssetCount > 0 ? (
                  <button type="button" className="web-rail-link" onClick={onShowAssets}>
                    {coveredAssetCount} on {coveredSiteCount} {coveredSiteCount === 1 ? "site" : "sites"}
                  </button>
                ) : (
                  "None"
                ),
            },
          ]}
        />
      </SidebarSection>
    </>
  );
}
