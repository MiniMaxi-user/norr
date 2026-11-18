"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import { updateWarehouseStockQuantity, updateWarehouseStockThreshold, type WarehouseStockRecord } from "../actions";
import { quantityInputValue } from "./stock-status";

/**
 * "Adjust stock" dialog (issue #222 replacement of the inline stepper and
 * threshold inputs): on-hand quantity and minimum threshold of ONE stock line.
 * Only the fields that changed are written, each through its existing action
 * (`updateWarehouseStockQuantity` / `updateWarehouseStockThreshold`). An empty
 * minimum clears the threshold.
 */
export function StockEditDialog({ stock, onClose }: { stock: WarehouseStockRecord; onClose: () => void }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(quantityInputValue(stock.quantity));
  const [threshold, setThreshold] = useState(quantityInputValue(stock.min_threshold));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const nextQuantity = Number(quantity.replace(",", "."));
    if (!quantity.trim() || !Number.isFinite(nextQuantity) || nextQuantity < 0) {
      setError("Enter a quantity of 0 or more");
      return;
    }
    const trimmed = threshold.trim().replace(",", ".");
    const nextThreshold = trimmed === "" ? null : Number(trimmed);
    if (nextThreshold !== null && (!Number.isFinite(nextThreshold) || nextThreshold < 0)) {
      setError("Enter a minimum of 0 or more, or leave it empty");
      return;
    }
    setError(null);
    setSaving(true);
    if (nextQuantity !== stock.quantity) {
      const result = await updateWarehouseStockQuantity(stock.id, nextQuantity);
      if (!result.data) {
        setSaving(false);
        setError(result.error ?? "Could not update the quantity.");
        return;
      }
    }
    if (nextThreshold !== stock.min_threshold) {
      const result = await updateWarehouseStockThreshold(stock.id, nextThreshold);
      if (!result.data) {
        setSaving(false);
        setError(result.error ?? "Could not update the minimum.");
        router.refresh();
        return;
      }
    }
    setSaving(false);
    onClose();
    router.refresh();
  }

  const label = stock.article?.article_number ?? "article";
  const unit = stock.article?.article_unit?.label;

  return (
    <WebConfirmDialog
      open
      title={`Adjust stock · ${label}`}
      confirmLabel="Save"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="stock-quantity">
            Quantity{unit ? ` (${unit})` : ""}
          </label>
          <input
            id="stock-quantity"
            className="web-input"
            type="number"
            min="0"
            step="0.001"
            data-numeric="true"
            autoFocus
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="stock-threshold">
            Minimum
          </label>
          <input
            id="stock-threshold"
            className="web-input"
            type="number"
            min="0"
            step="0.001"
            data-numeric="true"
            placeholder="No minimum"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </div>
      </div>
    </WebConfirmDialog>
  );
}
