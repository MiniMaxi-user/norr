"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { formatDate } from "@/lib/format/date";

export interface ContractsPanelProps {
  contracts: ContractRecord[];
}

/**
 * Read-only "Contracts" tab on the Client detail page
 * (docs/ARCHITECTURE.md "Relational detail pages") — every service
 * agreement against this client, each row linking to the real Contracts
 * module's detail page.
 *
 * Deliberately flat and read-only, same shape as the sibling "Work Orders"
 * tab (`work-orders-panel.tsx`): this task's scope is surfacing
 * *visibility* of the relationship, not duplicating the Contracts module's
 * own create/edit/delete affordances onto the Client page — those stay on
 * `/contracts` and `/contracts/[id]`.
 */
export function ContractsPanel({ contracts }: ContractsPanelProps) {
  const router = useRouter();

  return (
    <LinkedRecordsTable
      records={contracts}
      getKey={(contract) => contract.id}
      onRowClick={(contract) => router.push(`/contracts/${contract.id}`)}
      emptyIcon={<FileText />}
      emptyHeading="No contracts yet"
      emptyText="Service agreements for this client will show up here."
      columns={[
        { header: "Name", render: (contract) => contract.name },
        {
          header: "Type",
          align: "center",
          render: (contract) => (
            <Badge color={contract.contract_type?.color} variant="muted">
              {contract.contract_type?.label ?? "—"}
            </Badge>
          ),
        },
        { header: "Start date", render: (contract) => formatDate(contract.start_date) },
        { header: "End date", render: (contract) => formatDate(contract.end_date) },
      ]}
    />
  );
}
