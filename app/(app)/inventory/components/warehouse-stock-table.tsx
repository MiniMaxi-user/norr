"use client";

import { Boxes } from "@yourorg/ui/icons";
import { EmptyState, SectionHeader, Stack, SummaryRow, Table } from "@yourorg/ui";
import type { WarehouseStockRecord } from "../actions";
import { formatCurrency } from "@/lib/format/currency";
import { AddWarehouseArticleCombobox } from "./add-warehouse-article-combobox";
import { WarehouseStockRow } from "./warehouse-stock-row";

export interface WarehouseStockTableProps {
  warehouseId: string;
  stock: WarehouseStockRecord[];
  totalPurchaseValue: number;
  totalSaleValue: number;
  readOnly: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * The warehouse detail page's own stock section (issue #181): a type-and-
 * search "add article" field (hidden for Finance/`readOnly`), the inline-
 * editable stock table itself, and a `SummaryRow` footer totaling this
 * warehouse's own purchase/sale value — same "row list + `SummaryRow`
 * footer" shape `ContractLineItemsSection` uses for its own line items.
 */
export function WarehouseStockTable({
  warehouseId,
  stock,
  totalPurchaseValue,
  totalSaleValue,
  readOnly,
  canCreate,
  canUpdate,
  canDelete,
}: WarehouseStockTableProps) {
  // Rendered whenever there's either a Remove button OR a row-level error to
  // surface (an update-only actor without delete rights still needs
  // somewhere to see a failed quantity/threshold save) — in practice
  // `canUpdate`/`canDelete` are always equal for this module's RBAC matrix
  // (owner/planner/administratie hold full CRUD together, Finance holds
  // neither), so this is belt-and-braces rather than a real today-observable
  // case.
  const showActionsColumn = !readOnly && (canDelete || canUpdate);
  const canAddArticles = !readOnly && canCreate;

  return (
    <Stack gap="md">
      <SectionHeader icon={Boxes} title="Articles" />

      {canAddArticles && <AddWarehouseArticleCombobox warehouseId={warehouseId} />}

      {stock.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No articles in this warehouse yet"
          text={canAddArticles ? "Search above to add the first article." : "No articles have been added to this warehouse yet."}
        />
      ) : (
        <>
          <Table stickyHeader maxHeight="65vh">
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Article number</Table.HeaderCell>
                <Table.HeaderCell>Description</Table.HeaderCell>
                <Table.HeaderCell>Unit</Table.HeaderCell>
                <Table.HeaderCell align="center">Quantity</Table.HeaderCell>
                <Table.HeaderCell align="center">Min. threshold</Table.HeaderCell>
                <Table.HeaderCell align="center">Total consumed</Table.HeaderCell>
                <Table.HeaderCell>Last counted</Table.HeaderCell>
                <Table.HeaderCell align="center">Status</Table.HeaderCell>
                {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {stock.map((row) => (
                <WarehouseStockRow
                  key={row.id}
                  stock={row}
                  readOnly={readOnly}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  showActionsColumn={showActionsColumn}
                />
              ))}
            </Table.Body>
          </Table>

          <SummaryRow
            items={[
              { label: "Total purchase value", value: formatCurrency(totalPurchaseValue) },
              { label: "Total sale value", value: formatCurrency(totalSaleValue), emphasis: "serif" },
            ]}
          />
        </>
      )}
    </Stack>
  );
}
