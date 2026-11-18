"use client";

import { useMemo } from "react";
import { StatusText, WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import type { WarehouseListRecord } from "../actions";

const engineerName = (warehouse: WarehouseListRecord) =>
  warehouse.engineer?.full_name || warehouse.engineer?.email || "";

const STOCK_SEGMENT = {
  label: "Stock level",
  defaultValue: "all",
  options: [
    { value: "low", label: "Below minimum", match: (row: WarehouseListRecord) => row.lowStockCount > 0 },
    { value: "ok", label: "OK", match: (row: WarehouseListRecord) => row.lowStockCount === 0 },
    { value: "all", label: "All" },
  ] as const,
};

/**
 * The Inventory list table (list-page shell, issue #222): a
 * `WebDataTableCard` in client mode (one warehouse per engineer, so the whole
 * list is small). Columns: Warehouse (opens it), Engineer, Articles, Below
 * minimum, Purchase value, Sale value. Search, Engineer dropdown, stock-level
 * toggle and sort live in the URL. Warehouses cannot be created or deleted
 * here, so the ··· menu only offers Open.
 */
export function WarehousesTableCard({ warehouses }: { warehouses: WarehouseListRecord[] }) {
  const columns = useMemo<WebColumn<WarehouseListRecord>[]>(
    () => [
      { id: "name", header: "Warehouse", primary: true, sortValue: (row) => row.name, render: (row) => row.name },
      {
        id: "engineer",
        header: "Engineer",
        sortValue: (row) => engineerName(row),
        render: (row) => engineerName(row) || null,
      },
      {
        id: "articles",
        header: "Articles",
        align: "end",
        sortValue: (row) => row.stockRowCount,
        render: (row) => formatNumberWeb(row.stockRowCount),
      },
      {
        id: "low",
        header: "Below minimum",
        align: "end",
        sortValue: (row) => row.lowStockCount,
        render: (row) =>
          row.lowStockCount > 0 ? <StatusText tone="danger">{formatNumberWeb(row.lowStockCount)}</StatusText> : "0",
      },
      {
        id: "purchase",
        header: "Purchase value",
        align: "end",
        sortValue: (row) => row.totalPurchaseValue,
        render: (row) => formatMoneyWeb(row.totalPurchaseValue),
      },
      {
        id: "sale",
        header: "Sale value",
        align: "end",
        sortValue: (row) => row.totalSaleValue,
        render: (row) => formatMoneyWeb(row.totalSaleValue),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "engineer",
        label: "Engineer",
        getOptions: (row: WarehouseListRecord) =>
          row.engineer ? [{ value: row.engineer.id, label: engineerName(row) }] : [],
      },
    ],
    [],
  );

  return (
    <WebDataTableCard<WarehouseListRecord>
      rows={warehouses}
      getRowKey={(row) => row.id}
      columns={columns}
      searchText={(row) => `${row.name} ${engineerName(row)}`}
      noun="warehouses"
      dropdowns={dropdowns}
      segment={STOCK_SEGMENT}
      urlPrefix="wh"
      defaultSort={{ columnId: "name", direction: "asc" }}
      rowHref={(row) => `/inventory/${row.id}`}
      rowLabel={(row) => row.name}
      rowActions={(row) => [{ key: "open", label: "Open", href: `/inventory/${row.id}` }]}
      emptyAction="Every engineer gets their own warehouse automatically once they join your organization."
    />
  );
}
