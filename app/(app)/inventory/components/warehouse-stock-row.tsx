"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, ConfirmDeleteDialog, Input, Stepper, Table, Text } from "@yourorg/ui";
import { Trash2 } from "@yourorg/ui/icons";
import {
  removeArticleFromWarehouse,
  updateWarehouseStockQuantity,
  updateWarehouseStockThreshold,
  type WarehouseStockRecord,
} from "../actions";
import { formatDateTime } from "@/lib/format/date";

export interface WarehouseStockRowProps {
  stock: WarehouseStockRecord;
  /** Finance's read-only view — no stepper/inputs/remove, plain text cells. */
  readOnly: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Whether the table renders an Actions column at all — mirrors the
   * header cell so this row's own trailing `<Table.Cell>` count always
   * matches it exactly. */
  showActionsColumn: boolean;
}

type StockStatus = "danger" | "warning" | "success" | null;

/**
 * Row status color rule (no acceptance-criteria-specified exact boundary,
 * documented here since it's a non-obvious business rule): `null` (no color)
 * when no `min_threshold` is set at all — the rule simply doesn't apply yet.
 * Otherwise red at/below zero or strictly below the threshold, orange once
 * within 20% above the threshold ("getting close"), green safely above that
 * margin.
 */
function resolveStockStatus(quantity: number, minThreshold: number | null): StockStatus {
  if (minThreshold === null) return null;
  if (quantity <= 0 || quantity < minThreshold) return "danger";
  const closeMargin = minThreshold * 1.2;
  if (quantity <= closeMargin) return "warning";
  return "success";
}

const STATUS_LABEL: Record<Exclude<StockStatus, null>, string> = {
  danger: "Low stock",
  warning: "Near threshold",
  success: "OK",
};

function formatQuantity(value: number): string {
  // Up to 3 decimals (matches `warehouseStockQuantitySchema`), trimmed of
  // trailing zeros for a cleaner read-only/display value.
  return String(Math.round(value * 1000) / 1000);
}

/**
 * A single `warehouse_stock` row — inline-editable Quantity (steppers +
 * direct typing) and Min. threshold, read-only Total consumed/Last counted,
 * a computed status `Badge`, and a Remove action. Owns its own local
 * editing state so a `+`/`-` click or a blur-commit on one row never
 * re-renders every other row in the table.
 */
export function WarehouseStockRow({
  stock,
  readOnly,
  canUpdate,
  canDelete,
  showActionsColumn,
}: WarehouseStockRowProps) {
  const router = useRouter();

  const [quantity, setQuantity] = useState(stock.quantity);
  const [quantityInput, setQuantityInput] = useState(formatQuantity(stock.quantity));
  const [savingQuantity, setSavingQuantity] = useState(false);

  const [thresholdInput, setThresholdInput] = useState(
    stock.min_threshold === null ? "" : formatQuantity(stock.min_threshold),
  );
  const [minThreshold, setMinThreshold] = useState(stock.min_threshold);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Re-sync from the server's own value whenever it actually changes (e.g.
  // this row's own `commitQuantity`/`commitThreshold` below already syncs
  // synchronously from the action's response, but `router.refresh()`
  // re-delivers the same value as a fresh prop a moment later — and this is
  // also what keeps a long-lived row instance correct if the underlying
  // record ever changes from outside this component). Same "sync from the
  // outside value" convention `Combobox`/`ArticlesFilters` already use.
  useEffect(() => {
    setQuantity(stock.quantity);
    setQuantityInput(formatQuantity(stock.quantity));
  }, [stock.quantity]);

  useEffect(() => {
    setMinThreshold(stock.min_threshold);
    setThresholdInput(stock.min_threshold === null ? "" : formatQuantity(stock.min_threshold));
  }, [stock.min_threshold]);

  async function commitQuantity(next: number) {
    if (next < 0 || Number.isNaN(next)) {
      setQuantityInput(formatQuantity(quantity));
      return;
    }
    setSavingQuantity(true);
    setError(null);
    const result = await updateWarehouseStockQuantity(stock.id, next);
    setSavingQuantity(false);
    if (!result.data) {
      setError(result.error ?? "Could not update quantity.");
      setQuantityInput(formatQuantity(quantity));
      return;
    }
    setQuantity(result.data.warehouseStock.quantity);
    setQuantityInput(formatQuantity(result.data.warehouseStock.quantity));
    router.refresh();
  }

  async function commitThreshold(next: number | null) {
    setSavingThreshold(true);
    setError(null);
    const result = await updateWarehouseStockThreshold(stock.id, next);
    setSavingThreshold(false);
    if (!result.data) {
      setError(result.error ?? "Could not update the minimum threshold.");
      setThresholdInput(minThreshold === null ? "" : formatQuantity(minThreshold));
      return;
    }
    setMinThreshold(result.data.warehouseStock.min_threshold);
    setThresholdInput(
      result.data.warehouseStock.min_threshold === null ? "" : formatQuantity(result.data.warehouseStock.min_threshold),
    );
    router.refresh();
  }

  const status = resolveStockStatus(quantity, minThreshold);
  const canEditRow = !readOnly && canUpdate;

  return (
    <Table.Row>
      <Table.Cell>{stock.article?.article_number ?? "—"}</Table.Cell>
      <Table.Cell>{stock.article?.description ?? "—"}</Table.Cell>
      <Table.Cell>{stock.article?.article_unit?.label ?? "—"}</Table.Cell>
      <Table.Cell align="center">
        {canEditRow ? (
          <Stepper
            onDecrement={() => commitQuantity(Math.max(0, quantity - 1))}
            onIncrement={() => commitQuantity(quantity + 1)}
            decrementDisabled={savingQuantity || quantity <= 0}
            incrementDisabled={savingQuantity}
            decrementLabel={`Decrease quantity for ${stock.article?.article_number ?? "article"}`}
            incrementLabel={`Increase quantity for ${stock.article?.article_number ?? "article"}`}
          >
            <Input
              aria-label={`Quantity for ${stock.article?.article_number ?? "article"}`}
              type="number"
              min="0"
              step="0.001"
              style={{ width: "5rem", textAlign: "center" }}
              value={quantityInput}
              disabled={savingQuantity}
              onChange={(event) => setQuantityInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(quantityInput);
                if (parsed !== quantity) commitQuantity(parsed);
                else setQuantityInput(formatQuantity(quantity));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </Stepper>
        ) : (
          formatQuantity(quantity)
        )}
      </Table.Cell>
      <Table.Cell align="center">
        {canEditRow ? (
          <Input
            aria-label={`Minimum threshold for ${stock.article?.article_number ?? "article"}`}
            type="number"
            min="0"
            step="0.001"
            placeholder="—"
            style={{ width: "5.5rem", textAlign: "center" }}
            value={thresholdInput}
            disabled={savingThreshold}
            onChange={(event) => setThresholdInput(event.target.value)}
            onBlur={() => {
              const trimmed = thresholdInput.trim();
              const next = trimmed === "" ? null : Number(trimmed);
              if (next !== minThreshold) commitThreshold(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        ) : minThreshold === null ? (
          "—"
        ) : (
          formatQuantity(minThreshold)
        )}
      </Table.Cell>
      <Table.Cell align="center">{formatQuantity(stock.total_consumed)}</Table.Cell>
      <Table.Cell>{formatDateTime(stock.last_counted_at)}</Table.Cell>
      <Table.Cell align="center">
        {status ? <Badge variant={status}>{STATUS_LABEL[status]}</Badge> : <Text tone="muted">—</Text>}
      </Table.Cell>
      {showActionsColumn && (
        <Table.Cell align="center">
          <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
            {error && <Text tone="danger">{error}</Text>}
            {canDelete && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                aria-label={`Remove ${stock.article?.article_number ?? "article"} from this warehouse`}
                onClick={() => setRemoving(true)}
              >
                <Trash2 />
              </Button>
            )}
          </span>
        </Table.Cell>
      )}

      {removing && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setRemoving(false)}
          title={`Remove ${stock.article?.article_number ?? "article"}?`}
          fallbackMessage="This removes the article from this warehouse. This action cannot be undone."
          onConfirm={async () => {
            const result = await removeArticleFromWarehouse(stock.id);
            return { error: result.error };
          }}
          onDeleted={() => {
            setRemoving(false);
            router.refresh();
          }}
          confirmLabel="Remove"
        />
      )}
    </Table.Row>
  );
}
