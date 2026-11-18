"use client";

import { SidebarRows, SidebarSection } from "@yourorg/ui/web";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { formatDateTimeWeb, formatDateWeb } from "@/lib/format/web";
import { memberDisplayName } from "@/lib/members/format";
import type { ActivityRecord } from "../actions";

export interface ActivityRailProps {
  activity: ActivityRecord;
  /** The linked asset's record, for the Object section (`null` = none). */
  assetRecord: AssetRecord | null;
  /** Whether the activity is finished (status "completed"). */
  isDone: boolean;
}

function openForText(reportedAt: string): string {
  const reported = new Date(reportedAt).getTime();
  if (Number.isNaN(reported)) return "—";
  const days = Math.floor(Math.max(0, Date.now() - reported) / 86_400_000);
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Right rail of the Activity page (design system, issue #222): Reported (when,
 * by whom and — while the activity is not done — how long it has been open) ·
 * Object (what the asset is, only facts on its record) · TIMELINE (added by
 * `WebDetailLayout`). Read-only, and it does not repeat the Overview: client,
 * asset, contact and action holder are all in the Details card.
 *
 * No LivePanel: an activity has no deadline, SLA or running timer, and no
 * status-bound action that is only valid at one moment (changing the status is
 * a plain field on the Overview), so nothing is "happening now".
 */
export function ActivityRail({ activity, assetRecord, isDone }: ActivityRailProps) {
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
      <SidebarSection title="Reported">
        <SidebarRows
          rows={[
            { label: "Reported at", value: formatDateTimeWeb(activity.reported_at) },
            { label: "Reported by", value: activity.reporter ? memberDisplayName(activity.reporter) : "—" },
            ...(isDone ? [] : [{ label: "Open for", value: openForText(activity.reported_at) }]),
          ]}
        />
      </SidebarSection>

      {assetRecord ? (
        <SidebarSection title="Object" link={{ label: "Open asset", href: `/assets/${assetRecord.id}` }}>
          <SidebarRows rows={objectRows} />
        </SidebarSection>
      ) : null}
    </>
  );
}
