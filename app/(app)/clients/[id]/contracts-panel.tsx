"use client";

import { useMemo } from "react";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { CreateContractButton } from "@/app/(app)/contracts/components/create-contract-button";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import { contractLabel } from "@/lib/format/contract-label";

export interface ContractsPanelProps {
  clientId: string;
  contracts: ContractRecord[];
  /** `can(actor, "contracts", "create")`, resolved once in `page.tsx`. */
  canCreate: boolean;
}

/**
 * Contracts tab (docs/ARCHITECTURE.md "Relational detail pages"; design-system
 * table pattern, issue #222): one card with a FilterBar — Type dropdown and
 * Active · Ended · All (default Active; "ended" = end date in the past, the
 * same reading of "active" the client page's key figures use). "+ Contract"
 * opens `/contracts/new` with this client pre-scoped.
 */
export function ContractsPanel({ clientId, contracts, canCreate }: ContractsPanelProps) {
  const columns = useMemo<WebColumn<ContractRecord>[]>(
    () => [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortValue: (contract) => contract.contract_number,
        render: (contract) => contractLabel(contract),
      },
      {
        id: "type",
        header: "Type",
        sortValue: (contract) => contract.contract_type?.label ?? "",
        render: (contract) => contract.contract_type?.label ?? "—",
      },
      {
        id: "start",
        header: "Start date",
        sortValue: (contract) => contract.start_date,
        render: (contract) => formatDateWeb(contract.start_date),
      },
      {
        id: "end",
        header: "End date",
        sortValue: (contract) => contract.end_date,
        render: (contract) => formatDateWeb(contract.end_date),
      },
      {
        id: "value",
        header: "Value",
        align: "end",
        sortValue: (contract) => contract.value,
        render: (contract) => formatMoneyWeb(contract.value),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        getOptions: (contract: ContractRecord) =>
          contract.contract_type ? [{ value: contract.contract_type.value, label: contract.contract_type.label }] : [],
      },
    ],
    [],
  );

  const segment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isActive = (contract: ContractRecord) => !contract.end_date || contract.end_date >= today;
    return {
      label: "Show contracts",
      defaultValue: "active",
      options: [
        { value: "active", label: "Active", match: isActive },
        { value: "ended", label: "Ended", match: (contract: ContractRecord) => !isActive(contract) },
        { value: "all", label: "All" },
      ] as const,
    };
  }, []);

  return (
    <WebDataTableCard
      title="Contracts"
      meta={String(contracts.length)}
      rows={contracts}
      getRowKey={(contract) => contract.id}
      columns={columns}
      searchText={(contract) =>
        [contract.contract_number, contract.external_reference, contract.contract_type?.label].filter(Boolean).join(" ")
      }
      noun="contracts"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="contracts"
      defaultSort={{ columnId: "start", direction: "desc" }}
      rowHref={(contract) => `/contracts/${contract.id}`}
      rowLabel={(contract) => contract.contract_number}
      add={canCreate ? <CreateContractButton clientId={clientId} label="+ Contract" filterBar /> : undefined}
      emptyAction={canCreate ? "Use + Contract to add the first service agreement." : undefined}
    />
  );
}
