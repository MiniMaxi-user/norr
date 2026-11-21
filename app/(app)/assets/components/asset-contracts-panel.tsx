"use client";

import { useMemo, type ReactNode } from "react";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { AssetContractCoverage } from "@/app/(app)/contracts/actions";
import { formatDateWeb } from "@/lib/format/web";
import { contractLabel } from "@/lib/format/contract-label";

export interface AssetContractsPanelProps {
  coverage: AssetContractCoverage[];
  /** Allowed to link/unlink contracts (asset update permission). */
  canManage: boolean;
  onLink: () => void;
  onUnlink: (contractId: string) => void;
}

/**
 * Asset "Contracts" tab (design-system table pattern, issue #222): every
 * contract covering this asset — linked directly or inherited through a
 * composite parent — in one card with a FilterBar. "+ Link contract" opens
 * the existing link dialog; unlinking (direct links only) is in the row ···
 * menu. Inherited rows say which asset they come through.
 */
export function AssetContractsPanel({ coverage, canManage, onLink, onUnlink }: AssetContractsPanelProps) {
  const columns = useMemo<WebColumn<AssetContractCoverage>[]>(
    () => [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortValue: (entry) => entry.contract.contract_number,
        render: (entry) => contractLabel(entry.contract),
      },
      {
        id: "type",
        header: "Type",
        sortValue: (entry) => entry.contract.contract_type?.label ?? "",
        render: (entry) => entry.contract.contract_type?.label ?? "—",
      },
      {
        id: "source",
        header: "Coverage",
        sortValue: (entry) => entry.source.type,
        render: (entry): ReactNode =>
          entry.source.type === "inherited" ? `Inherited via ${entry.source.viaAsset.name}` : "Direct",
      },
      {
        id: "start",
        header: "Start date",
        sortValue: (entry) => entry.contract.start_date,
        render: (entry) => formatDateWeb(entry.contract.start_date),
      },
      {
        id: "end",
        header: "End date",
        sortValue: (entry) => entry.contract.end_date,
        render: (entry) => formatDateWeb(entry.contract.end_date),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        getOptions: (entry: AssetContractCoverage) =>
          entry.contract.contract_type
            ? [{ value: entry.contract.contract_type.value, label: entry.contract.contract_type.label }]
            : [],
      },
      {
        id: "source",
        label: "Coverage",
        getOptions: (entry: AssetContractCoverage) => [
          { value: entry.source.type, label: entry.source.type === "inherited" ? "Inherited" : "Direct" },
        ],
      },
    ],
    [],
  );

  const segment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isActive = (entry: AssetContractCoverage) => !entry.contract.end_date || entry.contract.end_date >= today;
    return {
      label: "Show contracts",
      defaultValue: "active",
      options: [
        { value: "active", label: "Active", match: isActive },
        { value: "ended", label: "Ended", match: (entry: AssetContractCoverage) => !isActive(entry) },
        { value: "all", label: "All" },
      ] as const,
    };
  }, []);

  function rowActions(entry: AssetContractCoverage): WebMenuItem[] {
    const items: WebMenuItem[] = [{ key: "open", label: "Open contract", href: `/contracts/${entry.contract.id}` }];
    if (canManage && entry.source.type === "direct" && entry.contract.status !== "ended") {
      items.push({
        key: "unlink",
        label: entry.contract.status === "draft" ? "Unlink contract" : "Remove from contract…",
        danger: true,
        onSelect: () => onUnlink(entry.contract.id),
      });
    }
    return items;
  }

  return (
    <WebDataTableCard
      title="Contracts"
      meta={String(coverage.length)}
      rows={coverage}
      getRowKey={(entry) => entry.contract.id}
      columns={columns}
      searchText={(entry) =>
        [entry.contract.contract_number, entry.contract.external_reference, entry.contract.contract_type?.label]
          .filter(Boolean)
          .join(" ")
      }
      noun="contracts"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="contracts"
      defaultSort={{ columnId: "start", direction: "desc" }}
      rowHref={(entry) => `/contracts/${entry.contract.id}`}
      rowActions={rowActions}
      rowLabel={(entry) => entry.contract.contract_number}
      add={
        canManage ? (
          <WebButton size="filter" onClick={onLink}>
            + Link contract
          </WebButton>
        ) : undefined
      }
      emptyAction={canManage ? "Use + Link contract to cover this asset." : undefined}
    />
  );
}
