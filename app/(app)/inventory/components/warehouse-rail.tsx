"use client";

import { SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";

export interface WarehouseRailProps {
  /** From `getWarehouseLivePanel`; `null` most of the time. Always first. */
  livePanel: LivePanelData | null;
  articleCount: number;
  lowStockCount: number;
  totalPurchaseValue: number;
  totalSaleValue: number;
  /** Opens the Stock tab. */
  onShowStock: () => void;
}

/**
 * Right rail of the Warehouse page (design system, issue #222): [LivePanel] ·
 * Stock (key figures — article lines, lines below minimum, total purchase and
 * sale value; the Details card holds none of them) — above the always-last
 * TIMELINE (added by `WebDetailLayout`). Read-only.
 */
export function WarehouseRail({
  livePanel,
  articleCount,
  lowStockCount,
  totalPurchaseValue,
  totalSaleValue,
  onShowStock,
}: WarehouseRailProps) {
  return (
    <>
      <LivePanel panel={livePanel} />
      <SidebarSection title="Stock" link={{ label: "Open", onClick: onShowStock }}>
        <SidebarRows
          rows={[
            { label: "Articles", value: formatNumberWeb(articleCount) },
            { label: "Below minimum", value: formatNumberWeb(lowStockCount) },
            { label: "Purchase value", value: formatMoneyWeb(totalPurchaseValue) },
            { label: "Sale value", value: formatMoneyWeb(totalSaleValue) },
          ]}
        />
      </SidebarSection>
    </>
  );
}
