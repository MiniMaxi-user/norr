"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  createContractLineItem,
  deleteContractLineItem,
  updateContractLineItem,
  type ContractLineItemRecord,
} from "../actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";

export interface ContractLineItemsPanelProps {
  contractId: string;
  lineItems: ContractLineItemRecord[];
  articles: ArticleSelectOption[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const lineTotal = (row: ContractLineItemRecord) => row.quantity * row.unit_price;
const kindOf = (row: ContractLineItemRecord) => (row.is_volume ? "Volume" : "Standard");

/**
 * Line items tab (design system, issue #222): the articles a quote generated
 * from this contract is pre-populated with, as one card with a FilterBar and a
 * table. `+ Article` at the right of the FilterBar opens the same small dialog
 * as before (article, quantity, purchase and sale price, Volume flag); Edit and
 * Delete live in one ··· menu per row. Quantities, prices and totals are
 * right-aligned figures.
 */
export function ContractLineItemsPanel({
  contractId,
  lineItems,
  articles,
  canCreate,
  canUpdate,
  canDelete,
}: ContractLineItemsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ row: ContractLineItemRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<ContractLineItemRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const total = lineItems.reduce((sum, row) => sum + lineTotal(row), 0);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteContractLineItem(deleting.id);
    setDeletePending(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<ContractLineItemRecord>[]>(
    () => [
      {
        id: "number",
        header: "Article",
        mono: true,
        sortValue: (row) => row.article_number ?? "",
        render: (row) => row.article_number ?? "—",
      },
      {
        id: "description",
        header: "Description",
        sortValue: (row) => row.description ?? "",
        render: (row) => row.description ?? "—",
      },
      { id: "kind", header: "Kind", sortValue: (row) => kindOf(row), render: (row) => kindOf(row) },
      {
        id: "quantity",
        header: "Quantity",
        align: "end",
        sortValue: (row) => row.quantity,
        render: (row) => formatNumberWeb(row.quantity),
      },
      {
        id: "purchase",
        header: "Purchase price",
        align: "end",
        sortValue: (row) => row.purchase_price,
        render: (row) => formatMoneyWeb(row.purchase_price),
      },
      {
        id: "price",
        header: "Sale price",
        align: "end",
        sortValue: (row) => row.unit_price,
        render: (row) => formatMoneyWeb(row.unit_price),
      },
      {
        id: "total",
        header: "Total",
        align: "end",
        sortValue: (row) => lineTotal(row),
        render: (row) => formatMoneyWeb(lineTotal(row)),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "kind",
        label: "Kind",
        getOptions: (row: ContractLineItemRecord) => [
          row.is_volume ? { value: "volume", label: "Volume" } : { value: "standard", label: "Standard" },
        ],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show line items",
      defaultValue: "all",
      options: [
        { value: "standard", label: "Standard", match: (row: ContractLineItemRecord) => !row.is_volume },
        { value: "volume", label: "Volume", match: (row: ContractLineItemRecord) => row.is_volume },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: ContractLineItemRecord): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (canUpdate) items.push({ key: "edit", label: "Edit…", onSelect: () => setDialog({ row }) });
    if (canDelete) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({
        key: "delete",
        label: "Delete",
        danger: true,
        onSelect: () => {
          setDeleteError(null);
          setDeleting(row);
        },
      });
    }
    return items;
  };

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Line items"
        meta={`${lineItems.length} · ${formatMoneyWeb(total)}`}
        rows={lineItems}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.article_number ?? ""} ${row.description ?? ""}`}
        noun="line items"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="lines"
        defaultSort={{ columnId: "number", direction: "asc" }}
        rowActions={rowActions}
        rowLabel={(row) => row.article_number ?? "line item"}
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setDialog({ row: null })}>
              + Article
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Article to add what a quote for this contract starts with." : undefined}
      />

      {dialog ? (
        <LineItemDialog
          key={dialog.row?.id ?? "new"}
          contractId={contractId}
          row={dialog.row}
          articles={articles}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <WebConfirmDialog
        open={Boolean(deleting)}
        title="Delete line item?"
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deletePending}
        error={deleteError}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        This line item is removed from the contract. This cannot be undone.
      </WebConfirmDialog>
    </div>
  );
}

function LineItemDialog({
  contractId,
  row,
  articles,
  onClose,
}: {
  contractId: string;
  row: ContractLineItemRecord | null;
  articles: ArticleSelectOption[];
  onClose: () => void;
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

  // Picking an article proposes its own prices, which stay editable.
  function handleArticleChange(id: string) {
    setArticleId(id);
    const picked = articles.find((article) => article.id === id);
    if (picked) {
      setSalePrice(picked.sale_price === null ? "" : String(picked.sale_price));
      setPurchasePrice(picked.purchase_price === null ? "" : String(picked.purchase_price));
    }
  }

  async function handleSave() {
    const parsedQuantity = Number(quantity.replace(",", "."));
    const parsedSalePrice = Number(salePrice.replace(",", "."));
    const parsedPurchasePrice = Number(purchasePrice.replace(",", "."));
    if (!articleId || !pickedArticle) {
      setError("Choose an article");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero");
      return;
    }
    if (!salePrice.trim() || !Number.isFinite(parsedSalePrice) || parsedSalePrice < 0) {
      setError("Enter a sale price of 0 or more");
      return;
    }
    if (!purchasePrice.trim() || !Number.isFinite(parsedPurchasePrice) || parsedPurchasePrice < 0) {
      setError("Enter a purchase price of 0 or more");
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
    onClose();
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open
      title={row ? "Edit line item" : "Add line item"}
      confirmLabel="Save"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-line-article">
            Article
          </label>
          <Combobox
            id="contract-line-article"
            options={articleOptions}
            value={articleId}
            onChange={handleArticleChange}
            placeholder="Search by article number or description…"
            emptyMessage="No matching articles"
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-line-quantity">
            Quantity
          </label>
          <input
            id="contract-line-quantity"
            className="web-input"
            type="number"
            step="0.001"
            min="0.001"
            data-numeric="true"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-line-purchase">
            Purchase price
          </label>
          <input
            id="contract-line-purchase"
            className="web-input"
            type="number"
            step="0.01"
            min="0"
            data-numeric="true"
            value={purchasePrice}
            onChange={(event) => setPurchasePrice(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-line-sale">
            Sale price
          </label>
          <input
            id="contract-line-sale"
            className="web-input"
            type="number"
            step="0.01"
            min="0"
            data-numeric="true"
            value={salePrice}
            onChange={(event) => setSalePrice(event.target.value)}
          />
        </div>
        <label className="web-field-checkbox">
          <input type="checkbox" checked={isVolume} onChange={(event) => setIsVolume(event.target.checked)} />
          Volume (a pre-agreed allowance, not a plain sale-priced line)
        </label>
      </div>
    </WebConfirmDialog>
  );
}
