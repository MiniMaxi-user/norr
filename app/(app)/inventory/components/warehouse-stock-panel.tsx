"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WebButton } from "@yourorg/ui/web";
import {
  StatusText,
  WebConfirmDialog,
  WebDataTableCard,
  type WebColumn,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import { formatDateTimeWeb, formatNumberWeb } from "@/lib/format/web";
import { removeArticleFromWarehouse, type WarehouseStockRecord } from "../actions";
import { StockAddDialog } from "./stock-add-dialog";
import { StockEditDialog } from "./stock-edit-dialog";
import { resolveStockStatus, STOCK_STATUS_LABEL, STOCK_STATUS_TONE } from "./stock-status";

export interface WarehouseStockPanelProps {
  warehouseId: string;
  stock: WarehouseStockRecord[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const statusOf = (row: WarehouseStockRecord) => resolveStockStatus(row.quantity, row.min_threshold);

const SEGMENT = {
  label: "Stock level",
  defaultValue: "all",
  options: [
    { value: "low", label: "Below minimum", match: (row: WarehouseStockRecord) => statusOf(row) === "low" },
    {
      value: "in",
      label: "In stock",
      match: (row: WarehouseStockRecord) => statusOf(row) !== "low" && row.quantity > 0,
    },
    { value: "all", label: "All" },
  ] as const,
};

/**
 * Stock tab of the warehouse page (design system, issue #222): one card with
 * a FilterBar and a client-mode table of the warehouse's stock lines
 * (search, Unit / Status dropdowns, Below minimum / In stock / All toggle).
 * `+ Article` at the right of the FilterBar opens the add dialog (create
 * right). Per row, ONE ··· menu: Adjust stock… (quantity and minimum, update
 * right) and Remove (delete right, with confirmation). Quantities are
 * right-aligned figures; article numbers mono; status is coloured text.
 */
export function WarehouseStockPanel({ warehouseId, stock, canCreate, canUpdate, canDelete }: WarehouseStockPanelProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WarehouseStockRecord | null>(null);
  const [removing, setRemoving] = useState<WarehouseStockRecord | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);

  async function confirmRemove() {
    if (!removing) return;
    setRemovePending(true);
    setRemoveError(null);
    const result = await removeArticleFromWarehouse(removing.id);
    setRemovePending(false);
    if (result.error) {
      setRemoveError(result.error);
      return;
    }
    setRemoving(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<WarehouseStockRecord>[]>(
    () => [
      {
        id: "number",
        header: "Article number",
        primary: true,
        mono: true,
        sortValue: (row) => row.article?.article_number ?? "",
        render: (row) => row.article?.article_number ?? "—",
      },
      {
        id: "description",
        header: "Description",
        sortValue: (row) => row.article?.description ?? "",
        render: (row) => row.article?.description ?? "—",
      },
      {
        id: "unit",
        header: "Unit",
        sortValue: (row) => row.article?.article_unit?.label ?? "",
        render: (row) => row.article?.article_unit?.label ?? null,
      },
      {
        id: "quantity",
        header: "Quantity",
        align: "end",
        sortValue: (row) => row.quantity,
        render: (row) => formatNumberWeb(row.quantity),
      },
      {
        id: "min",
        header: "Minimum",
        align: "end",
        sortValue: (row) => row.min_threshold,
        render: (row) => (row.min_threshold === null ? null : formatNumberWeb(row.min_threshold)),
      },
      {
        id: "consumed",
        header: "Consumed",
        align: "end",
        sortValue: (row) => row.total_consumed,
        render: (row) => formatNumberWeb(row.total_consumed),
      },
      {
        id: "counted",
        header: "Last counted",
        sortValue: (row) => row.last_counted_at ?? "",
        render: (row) => (row.last_counted_at ? formatDateTimeWeb(row.last_counted_at) : null),
      },
      {
        id: "status",
        header: "Status",
        sortValue: (row) => STOCK_STATUS_LABEL[statusOf(row)],
        render: (row) => {
          const status = statusOf(row);
          return <StatusText display="auto" tone={STOCK_STATUS_TONE[status]}>{STOCK_STATUS_LABEL[status]}</StatusText>;
        },
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "unit",
        label: "Unit",
        getOptions: (row: WarehouseStockRecord) =>
          row.article?.article_unit ? [{ value: row.article.article_unit.value, label: row.article.article_unit.label }] : [],
      },
      {
        id: "status",
        label: "Status",
        getOptions: (row: WarehouseStockRecord) => [{ value: statusOf(row), label: STOCK_STATUS_LABEL[statusOf(row)] }],
      },
    ],
    [],
  );

  const rowActions = (row: WarehouseStockRecord): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (canUpdate) items.push({ key: "adjust", label: "Adjust stock…", onSelect: () => setEditing(row) });
    if (canDelete) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({
        key: "remove",
        label: "Remove from warehouse",
        danger: true,
        onSelect: () => {
          setRemoveError(null);
          setRemoving(row);
        },
      });
    }
    return items;
  };
  const hasRowActions = canUpdate || canDelete;

  return (
    <div className="web-tab-stack">
      <WebDataTableCard<WarehouseStockRecord>
        title="Stock"
        meta={String(stock.length)}
        rows={stock}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.article?.article_number ?? ""} ${row.article?.description ?? ""}`}
        noun="articles"
        dropdowns={dropdowns}
        segment={SEGMENT}
        urlPrefix="stock"
        defaultSort={{ columnId: "number", direction: "asc" }}
        onRowClick={canUpdate ? (row) => setEditing(row) : undefined}
        rowActions={hasRowActions ? rowActions : undefined}
        rowLabel={(row) => row.article?.article_number ?? "article"}
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setAdding(true)}>
              + Article
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Article to add the first article to this warehouse." : undefined}
      />

      {adding ? <StockAddDialog warehouseId={warehouseId} onClose={() => setAdding(false)} /> : null}
      {editing ? <StockEditDialog key={editing.id} stock={editing} onClose={() => setEditing(null)} /> : null}

      <WebConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.article?.article_number ?? "article"}?`}
        confirmLabel="Remove"
        confirmVariant="danger"
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        This removes the article from this warehouse. This cannot be undone.
      </WebConfirmDialog>
    </div>
  );
}
