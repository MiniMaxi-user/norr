"use client";

import { useRouter } from "next/navigation";
import { Badge, EmptyState, Table } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ContractRecord } from "@/app/(app)/contracts/actions";

export interface ContractsPanelProps {
  contracts: ContractRecord[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        heading="No contracts yet"
        text="Service agreements for this client will show up here."
      />
    );
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell align="center">Type</Table.HeaderCell>
          <Table.HeaderCell>Start date</Table.HeaderCell>
          <Table.HeaderCell>End date</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {contracts.map((contract) => (
          <Table.Row key={contract.id} onClick={() => router.push(`/contracts/${contract.id}`)}>
            <Table.Cell>{contract.name}</Table.Cell>
            <Table.Cell align="center">
              <Badge color={contract.contract_type?.color} variant="muted">
                {contract.contract_type?.label ?? "—"}
              </Badge>
            </Table.Cell>
            <Table.Cell>{formatDate(contract.start_date)}</Table.Cell>
            <Table.Cell>{formatDate(contract.end_date)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
