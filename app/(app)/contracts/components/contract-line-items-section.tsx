"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDeleteDialog,
  Dialog,
  EmptyState,
  Inline,
  Input,
  Label,
  RowCard,
  SectionHeader,
  Stack,
  SummaryRow,
  Text,
  type ComboboxOption,
} from "@yourorg/ui";
import { Boxes, Pencil, Trash2 } from "@yourorg/ui/icons";
import {
  createContractLineItem,
  deleteContractLineItem,
  updateContractLineItem,
  type ContractLineItemRecord,
} from "../actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatCurrency } from "@/lib/format/currency";

export interface ContractLineItemsSectionProps {
  contractId: string;
  lineItems: ContractLineItemRecord[];
  articles: ArticleSelectOption[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * "Line items" section (issue #122) — articles a Quote generated from this
 * contract should be pre-populated with. Mirrors `app/(app)/work-orders/
 * components/work-order-material-section.tsx`'s row-list + `SummaryRow` +
 * small `Dialog` "+ Article" shape almost exactly, with two additions the
 * work order equivalent doesn't need: an editable Sale price and an editable
 * Purchase price (both default to the picked article's own `sale_price`/
 * `purchase_price` the instant it's chosen, then freely editable, same UX as
 * `lib/rate-overrides/rate-settings-section.tsx`'s article-picker-defaults-
 * the-price flow — `purchase_price` is stored/user-overridable on
 * `contract_line_items`, a deliberate exception to this codebase's usual
 * "read cost live" convention) and a "Volume" flag (`is_volume`), surfaced as
 * a checkbox in the dialog and a `Badge` on the row when set.
 * Edit-mode-only — `ContractScreen` never renders this before the contract
 * exists.
 */
export function ContractLineItemsSection({
  contractId,
  lineItems,
  articles,
  canCreate,
  canUpdate,
  canDelete,
}: ContractLineItemsSectionProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState<ContractLineItemRecord | null>(null);
  const [deletingRow, setDeletingRow] = useState<ContractLineItemRecord | null>(null);

  const total = lineItems.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);

  return (
    <Stack gap="md">
      <SectionHeader
        icon={Boxes}
        title="Line items"
        actions={
          canCreate && (
            <Button type="button" variant="primary" size="sm" onClick={() => setAdding(true)}>
              + Article
            </Button>
          )
        }
      />

      {lineItems.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No line items yet"
          text="Add the articles a Quote generated from this contract should be pre-populated with."
        />
      ) : (
        <>
          <Stack gap="xs">
            {lineItems.map((row) => {
              const total = row.quantity * row.unit_price;
              return (
                <RowCard key={row.id}>
                  <div className="ui-row-main">
                    <Text>{row.description ?? "—"}</Text>
                    <Text tone="muted" className="ui-row-code">
                      {row.article_number}
                    </Text>
                    {row.is_volume && <Badge variant="accent">Volume</Badge>}
                  </div>
                  <Text tone="muted" className="ui-row-mid ui-tabular-nums">
                    {row.quantity} × {formatCurrency(row.unit_price)}
                  </Text>
                  <Text className="ui-row-trailing ui-tabular-nums">{formatCurrency(total)}</Text>
                  <span className="ui-row-actions ui-row-actions-reserved">
                    {canUpdate && (
                      <Button type="button" variant="outline" size="sm" aria-label="Edit" onClick={() => setEditingRow(row)}>
                        <Pencil />
                      </Button>
                    )}
                    {canDelete && (
                      <Button type="button" variant="danger" size="sm" aria-label="Delete" onClick={() => setDeletingRow(row)}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </RowCard>
              );
            })}
          </Stack>
          <SummaryRow
            className="ui-summary-row-reserved"
            items={[{ label: "Total", value: formatCurrency(total), emphasis: "serif" }]}
          />
        </>
      )}

      {adding && (
        <ContractLineItemDialog
          open
          onOpenChange={(open) => !open && setAdding(false)}
          contractId={contractId}
          row={null}
          articles={articles}
        />
      )}
      {editingRow && (
        <ContractLineItemDialog
          open
          onOpenChange={(open) => !open && setEditingRow(null)}
          contractId={contractId}
          row={editingRow}
          articles={articles}
        />
      )}
      {deletingRow && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeletingRow(null);
          }}
          title="Delete line item?"
          onConfirm={async () => {
            const result = await deleteContractLineItem(deletingRow.id);
            return { error: result.error };
          }}
          onDeleted={() => {
            setDeletingRow(null);
            router.refresh();
          }}
          confirmLabel="Delete"
        />
      )}
    </Stack>
  );
}

function ContractLineItemDialog({
  open,
  onOpenChange,
  contractId,
  row,
  articles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  row: ContractLineItemRecord | null;
  articles: ArticleSelectOption[];
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(row?.article_id ?? "");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "1");
  const [salePrice, setSalePrice] = useState(row ? String(row.unit_price) : "");
  const [purchasePrice, setPurchasePrice] = useState(row ? String(row.purchase_price) : "");
  const [isVolume, setIsVolume] = useState(row?.is_volume ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickedArticle = articles.find((article) => article.id === articleId) ?? null;

  const articleOptions: ComboboxOption[] = articles.map((article) => ({
    value: article.id,
    label: `${article.article_number} — ${article.description}`,
    keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
  }));

  function handleArticleChange(id: string) {
    setArticleId(id);
    const picked = articles.find((article) => article.id === id);
    if (picked) {
      setSalePrice(picked.sale_price === null ? "" : String(picked.sale_price));
      setPurchasePrice(picked.purchase_price === null ? "" : String(picked.purchase_price));
    }
  }

  async function handleSave() {
    const parsedQuantity = Number(quantity);
    const parsedSalePrice = Number(salePrice);
    const parsedPurchasePrice = Number(purchasePrice);
    if (!articleId || !pickedArticle) {
      setError("Select an article.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (!Number.isFinite(parsedSalePrice) || parsedSalePrice < 0) {
      setError("Enter a valid sale price.");
      return;
    }
    if (!Number.isFinite(parsedPurchasePrice) || parsedPurchasePrice < 0) {
      setError("Enter a valid purchase price.");
      return;
    }
    setError(null);
    setSaving(true);
    const input = {
      articleId,
      articleNumber: pickedArticle.article_number,
      description: pickedArticle.description,
      quantity: parsedQuantity,
      unitPrice: parsedSalePrice,
      purchasePrice: parsedPurchasePrice,
      isVolume,
    };
    const result = row ? await updateContractLineItem(row.id, input) : await createContractLineItem(contractId, input);
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not save this line item.");
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>{row ? "Edit line item" : "Add line item"}</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="contract-line-item-article">Article</Label>
            <Combobox
              id="contract-line-item-article"
              options={articleOptions}
              value={articleId}
              onChange={handleArticleChange}
              placeholder="Search by article number or description…"
              emptyMessage="No matching articles"
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="contract-line-item-quantity">Quantity</Label>
            <Input
              id="contract-line-item-quantity"
              type="number"
              step="0.001"
              min="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="contract-line-item-purchase-price">Purchase price</Label>
            <Input
              id="contract-line-item-purchase-price"
              type="number"
              step="0.01"
              min="0"
              prefix="€"
              value={purchasePrice}
              onChange={(event) => setPurchasePrice(event.target.value)}
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="contract-line-item-sale-price">Sale price</Label>
            <Input
              id="contract-line-item-sale-price"
              type="number"
              step="0.01"
              min="0"
              prefix="€"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </Stack>
          <Inline gap="sm" align="center">
            <Checkbox
              id="contract-line-item-is-volume"
              checked={isVolume}
              onChange={(event) => setIsVolume(event.target.checked)}
            />
            <Label htmlFor="contract-line-item-is-volume">Volume</Label>
          </Inline>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
