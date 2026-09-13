"use client";

import { useRouter } from "next/navigation";
import { Table, Text } from "@yourorg/ui";
import type { WarehouseListRecord } from "../actions";
import { formatCurrency } from "@/lib/format/currency";

export interface WarehousesTableProps {
  warehouses: WarehouseListRecord[];
}

/**
 * Voorraad overview table (issue #181) — one row per engineer's warehouse.
 * Same "row always navigates to the detail page" convention `ArticlesTable`/
 * `ContractsTable` use — there's no per-row edit/delete action on this
 * screen at all (a warehouse can only be renamed/have its stock managed from
 * its own detail page), so there's no Actions column here either.
 */
export function WarehousesTable({ warehouses }: WarehousesTableProps) {
  const router = useRouter();

  return (
    <Table stickyHeader maxHeight="65vh">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Engineer</Table.HeaderCell>
          <Table.HeaderCell>Warehouse</Table.HeaderCell>
          <Table.HeaderCell align="center">Articles</Table.HeaderCell>
          <Table.HeaderCell>Total purchase value</Table.HeaderCell>
          <Table.HeaderCell>Total sale value</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {warehouses.map((warehouse) => (
          <Table.Row key={warehouse.id} onClick={() => router.push(`/inventory/${warehouse.id}`)}>
            <Table.Cell>
              {warehouse.engineer?.full_name || warehouse.engineer?.email || <Text tone="muted">—</Text>}
            </Table.Cell>
            <Table.Cell>{warehouse.name}</Table.Cell>
            <Table.Cell align="center">{warehouse.stockRowCount}</Table.Cell>
            <Table.Cell>{formatCurrency(warehouse.totalPurchaseValue)}</Table.Cell>
            <Table.Cell>{formatCurrency(warehouse.totalSaleValue)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
