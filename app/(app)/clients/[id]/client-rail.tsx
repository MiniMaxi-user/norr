"use client";

import { SidebarRows, SidebarSection, WebAmount, WebStatusBadge } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import { formatDateTimeWeb, formatMoneyWeb } from "@/lib/format/web";
import { SiteMapLoader, type SiteMapPin } from "./site-map-loader";

export interface ClientRailProps {
  /** From `getLivePanel`; `null` almost always. Always the first section. */
  livePanel: LivePanelData | null;
  accountManagerName: string | null;
  /** `null` = the Contracts module is not entitled/visible: row not shown. */
  activeContracts: { count: number; value: number } | null;
  /** `null` = Work Orders module not entitled/visible. */
  openWorkOrders: { count: number; nextAppointment: string | null } | null;
  potentialValue: number | null;
  primaryAddress: string | null;
  otherSiteCount: number;
  mapPins: SiteMapPin[];
  onManageSites: () => void;
  /** Platform-admin-only context (tenant status + modules), or `null`. */
  platform: { isActive: boolean; modules: string[]; onManage: () => void } | null;
}

/**
 * Right rail of the Client page (design system, issue #222 — "Kerncijfers" +
 * "Locaties" for a client; max 3 context sections above the always-last
 * TIMELINE, which `WebDetailLayout` adds). Read-only: nothing here is an
 * input. Replaces the old hero KPI tiles and the Company/Platform/Locations
 * rail cards (KvK/VAT/IBAN/phone now live in Business details).
 */
export function ClientRail({
  livePanel,
  accountManagerName,
  activeContracts,
  openWorkOrders,
  potentialValue,
  primaryAddress,
  otherSiteCount,
  mapPins,
  onManageSites,
  platform,
}: ClientRailProps) {
  const figures = [
    { label: "Account manager", value: accountManagerName ?? "—" },
    ...(activeContracts
      ? [
          {
            label: "Active contracts",
            value:
              activeContracts.count > 0 ? (
                <>
                  <WebStatusBadge tone="success">{activeContracts.count} active</WebStatusBadge>
                  {activeContracts.value > 0 ? ` · ${formatMoneyWeb(activeContracts.value, { whole: true })}` : null}
                </>
              ) : (
                "0"
              ),
          },
        ]
      : []),
    ...(openWorkOrders
      ? [
          {
            label: "Open work orders",
            value:
              openWorkOrders.count > 0 ? (
                <WebStatusBadge tone="warning">{openWorkOrders.count} open</WebStatusBadge>
              ) : (
                "0"
              ),
          },
          {
            label: "Next appointment",
            value: openWorkOrders.nextAppointment ? formatDateTimeWeb(openWorkOrders.nextAppointment) : "—",
          },
        ]
      : []),
    {
      label: "Potential",
      value: potentialValue !== null ? <WebAmount>{formatMoneyWeb(potentialValue, { whole: true })}</WebAmount> : "—",
    },
  ];

  return (
    <>
      <LivePanel panel={livePanel} />

      <SidebarSection title="Key figures">
        <SidebarRows rows={figures} />
      </SidebarSection>

      <SidebarSection title="Sites" link={{ label: "Manage", onClick: onManageSites }}>
        {mapPins.length > 0 ? (
          <div className="web-rail-map">
            <SiteMapLoader pins={mapPins} />
          </div>
        ) : null}
        {primaryAddress ? (
          <SidebarRows
            rows={[
              { label: "Main address", value: primaryAddress },
              ...(otherSiteCount > 0
                ? [{ label: "Other sites", value: String(otherSiteCount) }]
                : []),
            ]}
          />
        ) : (
          <p className="web-rail-empty">No sites yet</p>
        )}
      </SidebarSection>

      {platform ? (
        <SidebarSection title="Platform" link={{ label: "Manage", onClick: platform.onManage }}>
          <SidebarRows
            rows={[
              { label: "Tenant", value: platform.isActive ? "Active" : "Deactivated" },
              { label: "Modules", value: platform.modules.length > 0 ? platform.modules.join(", ") : "—" },
            ]}
          />
        </SidebarSection>
      ) : null}
    </>
  );
}
