"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  StatusText,
  WebDataTableCard,
  type FilterOption,
  type StatusTone,
  type WebColumn,
} from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { ContractRecord } from "../actions";
import { getContractStatus, type ContractPhase } from "./contract-status";
import { CONTRACTS_DROPDOWN_IDS, CONTRACTS_PAGE_SIZE, CONTRACTS_PHASE_SEGMENT } from "./contracts-query";
import { DeleteContractDialog } from "./delete-contract-dialog";

/** Client reference cell: a link in `text-link` (DS: clickable = coloured). */
function clientLink(clientId: string | null | undefined, name: string | undefined) {
  return clientId && name ? <Link href={`/clients/${clientId}`}>{name}</Link> : null;
}

const PHASE_TONE: Record<ContractPhase, StatusTone> = {
  active: "success",
  upcoming: "info",
  ended: "neutral",
};

export interface ContractsTableProps {
  contracts: ContractRecord[];
  clientNameById: Map<string, string>;
  /** Filter choices (ids = reference-list item / client ids). */
  clientOptions: FilterOption[];
  typeOptions: FilterOption[];
  slaTierOptions: FilterOption[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  canCreate: boolean;
  canDelete: boolean;
}

/**
 * Contracts list table (list-page shell, issue #222): a `WebDataTableCard`
 * in server mode. `listContracts` (driven by the `q`, `clientId`, `typeId`,
 * `slaTierId`, `seg`, `sort`, `dir` and `page` URL params) returns the
 * filtered page; this component renders it. A row (or the Number link) opens
 * the unified detail/edit screen (`/contracts/[id]`, where editing happens
 * inline, so there is no separate Edit action). One ··· menu per row: Open
 * and, with delete rights, Delete (confirmed in `DeleteContractDialog`).
 */
export function ContractsTable({
  contracts,
  clientNameById,
  clientOptions,
  typeOptions,
  slaTierOptions,
  total,
  unfilteredTotal,
  page,
  canCreate,
  canDelete,
}: ContractsTableProps) {
  const [deletingContract, setDeletingContract] = useState<ContractRecord | null>(null);

  const columns = useMemo<WebColumn<ContractRecord>[]>(
    () => [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortable: true,
        render: (contract) => contract.contract_number,
      },
      { id: "reference", header: "Reference", render: (contract) => contract.external_reference },
      { id: "client", header: "Client", render: (contract) => clientLink(contract.client_id, clientNameById.get(contract.client_id)) },
      { id: "type", header: "Type", render: (contract) => contract.contract_type?.label ?? null },
      { id: "sla", header: "SLA tier", render: (contract) => contract.sla_tier?.label ?? null },
      {
        id: "status",
        header: "Status",
        render: (contract) => {
          const status = getContractStatus(contract);
          return <StatusText display="auto" tone={PHASE_TONE[status.phase]}>{status.label}</StatusText>;
        },
      },
      { id: "billing", header: "Billing terms", render: (contract) => contract.billing_terms?.label ?? null },
      { id: "start", header: "Start date", sortable: true, render: (contract) => formatDateWeb(contract.start_date) },
      {
        id: "end",
        header: "End date",
        sortable: true,
        render: (contract) => (contract.end_date ? formatDateWeb(contract.end_date) : null),
      },
      {
        id: "nextInvoice",
        header: "Next invoice",
        sortable: true,
        render: (contract) => (contract.next_invoice_date ? formatDateWeb(contract.next_invoice_date) : null),
      },
      {
        id: "value",
        header: "Value",
        align: "end",
        sortable: true,
        render: (contract) => (contract.value === null ? null : formatMoneyWeb(contract.value)),
      },
    ],
    [clientNameById],
  );

  const dropdowns = useMemo(
    () => [
      { id: CONTRACTS_DROPDOWN_IDS.client, label: "Client", options: clientOptions },
      { id: CONTRACTS_DROPDOWN_IDS.type, label: "Type", options: typeOptions },
      { id: CONTRACTS_DROPDOWN_IDS.slaTier, label: "SLA tier", options: slaTierOptions },
    ],
    [clientOptions, typeOptions, slaTierOptions],
  );

  return (
    <>
      <WebDataTableCard<ContractRecord>
        rows={contracts}
        getRowKey={(contract) => contract.id}
        columns={columns}
        noun="contracts"
        dropdowns={dropdowns}
        segment={CONTRACTS_PHASE_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: CONTRACTS_PAGE_SIZE }}
        defaultSort={{ columnId: "number", direction: "desc" }}
        rowHref={(contract) => `/contracts/${contract.id}`}
        rowLabel={(contract) => contract.contract_number}
        rowActions={(contract) => [
          { key: "open", label: "Open", href: `/contracts/${contract.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeletingContract(contract) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/contracts/new" className="web-rail-link">
              Create contract
            </Link>
          ) : null
        }
      />
      {deletingContract ? (
        <DeleteContractDialog
          contract={deletingContract}
          open
          onOpenChange={(next) => !next && setDeletingContract(null)}
        />
      ) : null}
    </>
  );
}
