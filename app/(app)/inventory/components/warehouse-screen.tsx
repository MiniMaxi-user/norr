"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs, RecordHeroBand, Stack, StatStrip, type BreadcrumbItem, type StatStripItem } from "@yourorg/ui";
import { UserRound } from "@yourorg/ui/icons";
import { updateWarehouseName, type WarehouseRecord, type WarehouseStockRecord } from "../actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { formatCurrency } from "@/lib/format/currency";
import { WarehouseStockTable } from "./warehouse-stock-table";

export interface WarehouseScreenProps {
  breadcrumbItems: BreadcrumbItem[];
  warehouse: WarehouseRecord;
  stock: WarehouseStockRecord[];
  totalPurchaseValue: number;
  totalSaleValue: number;
  /** Never render an edit affordance RLS would reject — Finance's plain
   * `read` gets a fully read-only render (no name pencil/input, no add/
   * remove/quantity controls), same convention `ContractScreen`'s own
   * `readOnly` prop documents. */
  readOnly: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * The `/inventory/[warehouseId]` detail screen (issue #181) — a
 * `RecordHeroBand` with an inline-editable warehouse name (same "hero title
 * as an `<input>`" pattern `ContractScreen` uses for its own name field) plus
 * a `StatStrip` (Articles / Total purchase value / Total sale value), then
 * the warehouse's own stock table below.
 *
 * A warehouse has exactly one editable field of its own (`name`) — unlike
 * Contracts/Articles there's no multi-section rail of editable facts here,
 * so this screen owns just that one small piece of draft state directly
 * rather than a full `*Draft` object + per-section `EditableSection`s.
 */
export function WarehouseScreen({
  breadcrumbItems,
  warehouse,
  stock,
  totalPurchaseValue,
  totalSaleValue,
  readOnly,
  canCreate,
  canUpdate,
  canDelete,
}: WarehouseScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [name, setName] = useState(warehouse.name);

  async function handleNameBlur(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === warehouse.name) {
      setName(warehouse.name);
      return;
    }
    const result = await updateWarehouseName(warehouse.id, trimmed);
    if (!result.data) {
      setName(warehouse.name);
      return;
    }
    setName(result.data.warehouse.name);
    router.refresh();
  }

  const meta = [
    <>
      <UserRound />{" "}
      {warehouse.engineer?.full_name || warehouse.engineer?.email || "Unassigned"}
    </>,
  ];

  const stats: StatStripItem[] = [
    { label: "Articles", value: stock.length },
    { label: "Total purchase value", value: formatCurrency(totalPurchaseValue) },
    { label: "Total sale value", value: formatCurrency(totalSaleValue) },
  ];

  return (
    <Stack gap="lg">
      <RecordHeroBand
        title={
          readOnly ? (
            <h1 className="ui-record-hero-band-title">{name}</h1>
          ) : (
            <input
              className="ui-record-hero-band-title-input"
              value={name}
              aria-label="Warehouse name"
              onChange={(event) => setName(event.target.value)}
              onBlur={(event) => handleNameBlur(event.target.value)}
            />
          )
        }
        meta={meta}
        stats={<StatStrip items={stats} />}
      />

      <WarehouseStockTable
        warehouseId={warehouse.id}
        stock={stock}
        totalPurchaseValue={totalPurchaseValue}
        totalSaleValue={totalSaleValue}
        readOnly={readOnly}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
      />
    </Stack>
  );
}
