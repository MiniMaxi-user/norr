"use client";

import { SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { formatDateWeb } from "@/lib/format/web";

export interface WorkOrderRailProps {
  /** From `getLivePanel`; `null` most of the time. Always the first section. */
  livePanel: LivePanelData | null;
  /** The linked asset's record, for the Object section. */
  assetRecord: AssetRecord | null;
}

/**
 * Right rail of the Work order page (design system, issue #222): [LivePanel] ·
 * Object (what the asset is — only facts that exist on its record) · TIMELINE
 * (added by `WebDetailLayout`). Read-only.
 *
 * No Context section: client, site, asset, contract and source activity are
 * already the right-hand column of the Overview "Details" card, and the rail
 * must not repeat what the centre shows (DS 01 §4). There is no documents
 * concept on a work order yet, so no Documents section either.
 */
export function WorkOrderRail({ livePanel, assetRecord }: WorkOrderRailProps) {
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

      {assetRecord ? (
        <SidebarSection title="Object" link={{ label: "Open asset", href: `/assets/${assetRecord.id}` }}>
          <SidebarRows rows={objectRows} />
        </SidebarSection>
      ) : null}
    </>
  );
}
