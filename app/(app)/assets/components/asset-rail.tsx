"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SidebarNotice, SidebarProgress, SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { LivePanel, type LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb } from "@/lib/format/web";

export interface AssetRailProps {
  client: { id: string; name: string } | null;
  siteLabel: string | null;
  modelLabel: string | null;
  /** `null` = the Contracts module is not visible: contract rows hidden. */
  contracts: { first: ReactNode | null; extra: number; formLabel: string | null } | null;
  onManageContracts?: () => void;
  warranty: { until: string | null; termMonths: number | null; installedAt: string | null };
  /** Only when the asset is part of a composite structure (else `null`). */
  structure: { ancestors: { id: string; name: string }[]; componentCount: number; onShow: () => void } | null;
  /** From `getLivePanel`; `null` almost always. Always the first section. */
  livePanel: LivePanelData | null;
}

const DAY = 24 * 60 * 60 * 1000;
const EXPIRES_SOON_DAYS = 90;

/**
 * Right rail of the Asset page (design system, issue #222): Context (client,
 * site, model, contract as links), Warranty & contract (term, valid-until
 * with a progress bar, contract form, a gold notice when the warranty
 * expires soon or no contract covers the asset) and Structure (only when the
 * asset is part of a composite structure: path upward as links, component
 * count, link to the Structure tab) — max 3 context sections above the
 * always-last TIMELINE, with an optional LivePanel first. Read-only.
 */
export function AssetRail({
  client,
  siteLabel,
  modelLabel,
  contracts,
  onManageContracts,
  warranty,
  structure,
  livePanel,
}: AssetRailProps) {
  const now = Date.now();
  const until = warranty.until ? new Date(`${warranty.until}T00:00:00`).getTime() : NaN;
  const start = warranty.installedAt ? new Date(`${warranty.installedAt}T00:00:00`).getTime() : NaN;
  const hasUntil = !Number.isNaN(until);
  const expired = hasUntil && until < now;
  const daysLeft = hasUntil ? Math.ceil((until - now) / DAY) : null;
  const progress =
    hasUntil && !Number.isNaN(start) && until > start
      ? ((until - now) / (until - start)) * 100
      : hasUntil
        ? expired
          ? 0
          : 100
        : null;
  const expiresSoon = hasUntil && !expired && daysLeft !== null && daysLeft <= EXPIRES_SOON_DAYS;
  const noContract = contracts !== null && contracts.first === null;

  const contextRows = [
    { label: "Client", value: client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "—" },
    { label: "Site", value: siteLabel ?? "—" },
    { label: "Model", value: modelLabel ?? "—" },
    ...(contracts
      ? [
          {
            label: "Contract",
            value: contracts.first ? (
              <>
                {contracts.first}
                {contracts.extra > 0 ? ` +${contracts.extra} more` : ""}
              </>
            ) : (
              "—"
            ),
          },
        ]
      : []),
  ];

  const termLabel = warranty.termMonths !== null ? `${warranty.termMonths} months` : "—";

  return (
    <>
      <LivePanel panel={livePanel} />

      <SidebarSection title="Context">
        <SidebarRows rows={contextRows} />
      </SidebarSection>

      <SidebarSection
        title="Warranty & contract"
        link={onManageContracts ? { label: "Manage", onClick: onManageContracts } : undefined}
      >
        <SidebarRows
          rows={[
            { label: "Term", value: termLabel },
            { label: "Valid until", value: formatDateWeb(warranty.until) },
            ...(contracts ? [{ label: "Contract form", value: contracts.formLabel ?? "—" }] : []),
          ]}
        />
        {progress !== null ? (
          <SidebarProgress
            value={progress}
            label="Warranty remaining"
            tone={expired ? "danger" : expiresSoon ? "warning" : "success"}
          />
        ) : null}
        {expired ? <SidebarNotice>The warranty expired on {formatDateWeb(warranty.until)}.</SidebarNotice> : null}
        {expiresSoon ? (
          <SidebarNotice>
            The warranty expires in {daysLeft} {daysLeft === 1 ? "day" : "days"}.
          </SidebarNotice>
        ) : null}
        {noContract ? <SidebarNotice>No contract covers this asset.</SidebarNotice> : null}
      </SidebarSection>

      {structure ? (
        <SidebarSection title="Structure" link={{ label: "Structure", onClick: structure.onShow }}>
          {structure.ancestors.length > 0 ? (
            <p className="web-rail-path">
              {structure.ancestors.map((ancestor, index) => (
                <span key={ancestor.id}>
                  {index > 0 ? <span className="web-rail-path-sep"> › </span> : null}
                  <Link href={`/assets/${ancestor.id}`}>{ancestor.name}</Link>
                </span>
              ))}
            </p>
          ) : null}
          <SidebarRows
            rows={[
              {
                label: "Components",
                value:
                  structure.componentCount > 0
                    ? `${structure.componentCount} ${structure.componentCount === 1 ? "component" : "components"}`
                    : "None",
              },
            ]}
          />
        </SidebarSection>
      ) : null}
    </>
  );
}
