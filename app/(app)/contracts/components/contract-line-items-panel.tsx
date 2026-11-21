"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  createContractLineItem,
  deleteContractLineItem,
  updateContractLineItem,
  type ContractCounterOption,
  type ContractLineItemRecord,
} from "../actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import { billingMultiplier } from "@/app/(app)/quotes/contract-quote-helpers";

/** The contract's billing set-up, so the line dialog can show what the
 * entered values mean: prices and included quantities are per billing PERIOD;
 * each invoice (billing TERMS) covers `billingMultiplier` periods. */
export interface ContractBillingContext {
  periodLabel: string | null;
  periodMonths: number | null;
  termsLabel: string | null;
  termsMonths: number | null;
}

/** "month" / "quarter" / "year" / "3 months"; null when unknown. */
function periodNoun(months: number | null): string | null {
  if (!months) return null;
  if (months === 1) return "month";
  if (months === 3) return "quarter";
  if (months === 6) return "half year";
  if (months === 12) return "year";
  return `${months} months`;
}

export interface ContractLineItemsPanelProps {
  contractId: string;
  billing: ContractBillingContext;
  lineItems: ContractLineItemRecord[];
  articles: ArticleSelectOption[];
  counterOptions: ContractCounterOption[];
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
  counterOptions,
  billing,
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
        render: (row) => (row.article_id && row.article_number ? <Link href={`/articles/${row.article_id}`}>{row.article_number}</Link> : row.article_number ?? "—"),
      },
      {
        id: "description",
        header: "Description",
        sortValue: (row) => row.description ?? "",
        render: (row) => row.description ?? "—",
      },
      {
        id: "kind",
        header: "Kind",
        sortValue: (row) => kindOf(row),
        render: (row) => {
          if (!row.is_volume) return kindOf(row);
          const details = [
            row.volume_item?.label ?? null,
            row.overage_unit_price !== null ? `${formatMoneyWeb(row.overage_unit_price)} overage` : null,
          ].filter(Boolean);
          return details.length > 0 ? `Volume · ${details.join(" · ")}` : "Volume";
        },
      },
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
          counterOptions={counterOptions}
          billing={billing}
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
  counterOptions,
  billing,
  onClose,
}: {
  contractId: string;
  row: ContractLineItemRecord | null;
  articles: ArticleSelectOption[];
  counterOptions: ContractCounterOption[];
  billing: ContractBillingContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(row?.article_id ?? "");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "1");
  const [salePrice, setSalePrice] = useState(row ? String(row.unit_price) : "");
  const [purchasePrice, setPurchasePrice] = useState(row ? String(row.purchase_price) : "");
  const [isVolume, setIsVolume] = useState(row?.is_volume ?? false);
  const [volumeItemId, setVolumeItemId] = useState(row?.volume_item_id ?? "");
  const [overagePrice, setOveragePrice] = useState(row?.overage_unit_price != null ? String(row.overage_unit_price) : "");
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
      // The overage price starts at the article's sale price (editable).
      setOveragePrice(picked.sale_price === null ? "" : String(picked.sale_price));
    }
  }

  // Only counters on the covered assets; a saved counter stays selectable even
  // when it dropped out of that set (the warning below flags it).
  const counterComboOptions: ComboboxOption[] = counterOptions.map((counter) => ({
    value: counter.id,
    label: counter.unit ? `${counter.label} (${counter.unit})` : counter.label,
  }));
  if (row?.volume_item_id && !counterOptions.some((counter) => counter.id === row.volume_item_id)) {
    counterComboOptions.push({ value: row.volume_item_id, label: row.volume_item?.label ?? "Current counter" });
  }
  // What the entered values mean on each invoice (same multiplier as
  // generateContractQuotes: terms months / period months, else 1). On a
  // volume line the quantity IS the included counter quantity per period.
  const multiplier = billingMultiplier(billing.termsMonths, billing.periodMonths);
  const perPeriod = periodNoun(billing.periodMonths);
  const termsPeriod = periodNoun(billing.termsMonths);
  const toNumber = (text: string) => (text.trim() ? Number(text.replace(",", ".")) : NaN);
  const qty = toNumber(quantity);
  const price = toNumber(salePrice);
  const overage = toNumber(overagePrice);
  const pickedCounter = counterOptions.find((counter) => counter.id === volumeItemId) ?? null;
  const counterName = pickedCounter?.label ?? (volumeItemId ? (row?.volume_item?.label ?? "Counter") : null);
  const unit = pickedCounter?.unit ?? "unit";
  const settlesCounter = isVolume && Boolean(volumeItemId);
  const fixedAmount =
    Number.isFinite(qty) && Number.isFinite(price) ? Math.round(multiplier * qty * price * 100) / 100 : null;
  const includedPerInvoice = Number.isFinite(qty) ? Math.round(qty * multiplier * 1000) / 1000 : null;

  const counterNotCovered = isVolume && volumeItemId !== "" && !counterOptions.some((counter) => counter.id === volumeItemId);

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
    const parsedOverage = overagePrice.trim() ? Number(overagePrice.replace(",", ".")) : null;
    if (isVolume && parsedOverage !== null && (!Number.isFinite(parsedOverage) || parsedOverage < 0)) {
      setError("Enter an overage price of 0 or more");
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
      volumeItemId: isVolume && volumeItemId ? volumeItemId : null,
      overageUnitPrice: isVolume ? parsedOverage : null,
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
      size="lg"
      title={row ? "Edit line item" : "Add line item"}
      confirmLabel="Save"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-summary" data-tone="info">
          <span className="web-dialog-summary-title">Contract billing</span>
          Billing period <strong>{billing.periodLabel ?? "not set"}</strong> · Billing terms{" "}
          <strong>{billing.termsLabel ?? "not set"}</strong>
          <br />
          {perPeriod && termsPeriod ? (
            multiplier !== 1 ? (
              <>
                Enter quantity and prices <strong>per {perPeriod}</strong>. Each invoice covers a {termsPeriod}, so it
                charges <strong>{formatNumberWeb(multiplier)} ×</strong> what you enter.
              </>
            ) : (
              <>
                Enter quantity and prices <strong>per {perPeriod}</strong>; each invoice covers one {perPeriod}.
              </>
            )
          ) : (
            <>No fixed billing interval on the contract, so each invoice charges what you enter (× 1).</>
          )}
        </div>

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

        <p className="web-dialog-section">Price{perPeriod ? ` per ${perPeriod}` : ""}</p>
        <div className="web-dialog-row" data-columns="3">
          <div className="web-dialog-field">
            <label className="web-field-label" htmlFor="contract-line-quantity">
              {settlesCounter ? "Quantity (included)" : "Quantity"}
            </label>
            <div className="web-input-affix">
              <input
                id="contract-line-quantity"
                className="web-input"
                type="number"
                step="0.001"
                min="0.001"
                inputMode="decimal"
                data-numeric="true"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              {perPeriod ? <span className="web-input-affix-text">/ {perPeriod}</span> : null}
            </div>
          </div>
          <div className="web-dialog-field">
            <label className="web-field-label" htmlFor="contract-line-purchase">
              Purchase price
            </label>
            <div className="web-input-affix">
              <span className="web-input-affix-text" aria-hidden="true">
                €
              </span>
              <input
                id="contract-line-purchase"
                className="web-input"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                data-numeric="true"
                value={purchasePrice}
                onChange={(event) => setPurchasePrice(event.target.value)}
              />
              <span className="web-input-affix-text">/ {unit}</span>
            </div>
          </div>
          <div className="web-dialog-field">
            <label className="web-field-label" htmlFor="contract-line-sale">
              Sale price
            </label>
            <div className="web-input-affix">
              <span className="web-input-affix-text" aria-hidden="true">
                €
              </span>
              <input
                id="contract-line-sale"
                className="web-input"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                data-numeric="true"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
              />
              <span className="web-input-affix-text">/ {unit}</span>
            </div>
          </div>
        </div>

        <span className="web-field-checkbox">
          <input
            type="checkbox"
            aria-labelledby="contract-line-volume-text"
            checked={isVolume}
            onChange={(event) => {
              setIsVolume(event.target.checked);
              if (event.target.checked && !overagePrice.trim()) setOveragePrice(salePrice);
            }}
          />
          <span id="contract-line-volume-text">Volume: the quantity is a pre-agreed allowance, settled against a counter</span>
        </span>

        {isVolume ? (
          <>
            <p className="web-dialog-section">Counter settlement</p>
            <div className="web-dialog-row" data-columns="3">
              <div className="web-dialog-field" data-span="2">
                <label className="web-field-label" htmlFor="contract-line-counter">
                  Counter
                </label>
                <Combobox
                  id="contract-line-counter"
                  options={counterComboOptions}
                  value={volumeItemId}
                  onChange={setVolumeItemId}
                  placeholder="Search counters on the covered assets…"
                  emptyMessage="No counters on the covered assets"
                />
                {counterNotCovered ? (
                  <p className="web-hint-warning" role="status">
                    No covered asset has this counter
                  </p>
                ) : null}
              </div>
              <div className="web-dialog-field">
                <label className="web-field-label" htmlFor="contract-line-overage">
                  Overage price
                </label>
                <div className="web-input-affix">
                  <span className="web-input-affix-text" aria-hidden="true">
                    €
                  </span>
                  <input
                    id="contract-line-overage"
                    className="web-input"
                    type="number"
                    step="0.0001"
                    min="0"
                    inputMode="decimal"
                    data-numeric="true"
                    value={overagePrice}
                    onChange={(event) => setOveragePrice(event.target.value)}
                  />
                  <span className="web-input-affix-text">/ {unit}</span>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <div className="web-dialog-summary" data-tone="success" role="status" aria-live="polite">
          <span className="web-dialog-summary-title">
            Per invoice{billing.termsLabel ? ` (${billing.termsLabel})` : ""}
          </span>
          <dl className="web-dialog-summary-lines">
            <dt>
              Fixed
              {fixedAmount !== null
                ? `: ${multiplier !== 1 ? `${formatNumberWeb(multiplier)} × ` : ""}${formatNumberWeb(qty)} × ${formatMoneyWeb(price)}`
                : ""}
            </dt>
            <dd>{fixedAmount !== null ? formatMoneyWeb(fixedAmount) : "—"}</dd>
            {isVolume ? (
              <>
                <dt>Included{counterName ? ` (${counterName})` : ""}</dt>
                <dd>
                  {includedPerInvoice !== null ? `${formatNumberWeb(includedPerInvoice)} ${unit}` : "—"}
                </dd>
                <dt>Above that, per {unit}</dt>
                <dd>{Number.isFinite(overage) ? formatMoneyWeb(overage) : "not charged"}</dd>
              </>
            ) : null}
          </dl>
          {isVolume && !settlesCounter ? <>Pick a counter so usage above the included quantity can be settled.</> : null}
        </div>
      </div>
    </WebConfirmDialog>
  );
}
