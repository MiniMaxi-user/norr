"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Stack, Table, Text } from "@yourorg/ui";
import type { ContractRecord } from "../actions";
import { DeleteContractDialog } from "./delete-contract-dialog";

export interface ContractsTableProps {
  contracts: ContractRecord[];
  clientNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatValue(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * List view table for Contracts — same shape as
 * `app/(app)/work-orders/components/work-orders-table.tsx`: client-side
 * search over the current page, row click navigates to the detail page,
 * row-level Edit navigates to a real page (`/contracts/[id]/edit`, docs/
 * ARCHITECTURE.md "Popup vs. full page"), Delete stays a lightweight confirm
 * `Dialog`.
 */
export function ContractsTable({ contracts, clientNameById, canEdit, canDelete }: ContractsTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deletingContract, setDeletingContract] = useState<ContractRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter((contract) =>
      [
        contract.name,
        clientNameById.get(contract.client_id),
        contract.contract_type?.label,
        contract.sla_tier?.label,
        contract.billing_terms?.label,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [contracts, query, clientNameById]);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Stack gap="md">
        <Input
          aria-label="Search contracts on this page"
          placeholder="Search by name, client, type, SLA tier…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table stickyHeader maxHeight="65vh">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Client</Table.HeaderCell>
              <Table.HeaderCell align="center">Type</Table.HeaderCell>
              <Table.HeaderCell align="center">SLA Tier</Table.HeaderCell>
              <Table.HeaderCell>Billing terms</Table.HeaderCell>
              <Table.HeaderCell>Start date</Table.HeaderCell>
              <Table.HeaderCell>End date</Table.HeaderCell>
              <Table.HeaderCell>Value</Table.HeaderCell>
              {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.map((contract) => (
              <Table.Row key={contract.id} onClick={() => router.push(`/contracts/${contract.id}`)}>
                <Table.Cell>{contract.name}</Table.Cell>
                <Table.Cell>{clientNameById.get(contract.client_id) ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge color={contract.contract_type?.color} variant="muted">
                    {contract.contract_type?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                <Table.Cell align="center">
                  {contract.sla_tier ? (
                    <Badge color={contract.sla_tier.color} variant="muted">
                      {contract.sla_tier.label}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>{contract.billing_terms?.label ?? "—"}</Table.Cell>
                <Table.Cell>{formatDate(contract.start_date)}</Table.Cell>
                <Table.Cell>{formatDate(contract.end_date)}</Table.Cell>
                <Table.Cell>{formatValue(contract.value)}</Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/contracts/${contract.id}/edit`)}
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => setDeletingContract(contract)}
                        >
                          Delete
                        </Button>
                      )}
                    </span>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {filtered.length === 0 && <Text tone="muted">No contracts match &ldquo;{query}&rdquo;.</Text>}
      </Stack>

      {deletingContract && (
        <DeleteContractDialog
          contract={deletingContract}
          open
          onOpenChange={(next) => !next && setDeletingContract(null)}
        />
      )}
    </>
  );
}
