"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Combobox, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  createQuoteLineItem,
  deleteQuoteLineItem,
  updateQuoteLineItem,
  type QuoteLineItemRecord,
} from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import { lineTotal, netUnitPrice } from "./quote-totals";

export interface QuoteLineItemsPanelProps {
  quoteId: string;
  lineItems: QuoteLineItemRecord[];
  /** Assets of the quote's own client: resolves a line's optional asset and is the picker source. */
  clientAssets: AssetRecord[];
  /** Every active article (`listArticlesForSelect()`), the article picker's source. */
  articles: ArticleSelectOption[];
  /** This org's members: resolves `engineer_user_id` and feeds the engineer picker. */
  members: OrgMemberRecord[];
  /** `can(actor, "quotes", "create" | "update" | "delete")`. */
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const NO_ASSET = "none";

function assetLabel(asset: AssetRecord): string {
  return asset.asset_type?.label ? `${asset.name} (${asset.asset_type.label})` : asset.name;
}

/**
 * Line items tab (design system, issue #222): the priced items that make up
 * the quote, as one card with a FilterBar (search, Asset and Engineer
 * dropdowns, Articles · Manual · All) and a table. `+ Line` at the right of the
 * FilterBar opens a small dialog; Edit and Delete live in one ··· menu per
 * row. Quantities, prices and totals are right-aligned figures; the quote's
 * subtotal, VAT and total sit in the rail, not in a footer here.
 *
 * Picking an article proposes its number, description and sale price (which
 * stay editable); the purchase price and VAT rate come read-only from the
 * linked article. Asset (scoped to the quote's client) and engineer are
 * optional. Read-only for anyone without create/update/delete rights.
 */
export function QuoteLineItemsPanel({
  quoteId,
  lineItems,
  clientAssets,
  articles,
  members,
  canCreate,
  canUpdate,
  canDelete,
}: QuoteLineItemsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ row: QuoteLineItemRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<QuoteLineItemRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const assetById = useMemo(() => new Map(clientAssets.map((asset) => [asset.id, asset])), [clientAssets]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteQuoteLineItem(deleting.id);
    setDeletePending(false);
    if (!result.data) {
      setDeleteError(result.error ?? "Could not delete this line item.");
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<QuoteLineItemRecord>[]>(
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
        primary: true,
        sortValue: (row) => row.description,
        render: (row) => row.description,
      },
      {
        id: "asset",
        header: "Asset",
        sortValue: (row) => (row.asset_id ? (assetById.get(row.asset_id)?.name ?? "") : ""),
        render: (row) => {
          if (!row.asset_id) return "—";
          const asset = assetById.get(row.asset_id);
          return asset ? <Link href={`/assets/${asset.id}`}>{assetLabel(asset)}</Link> : "Unknown asset";
        },
      },
      {
        id: "engineer",
        header: "Engineer",
        sortValue: (row) => (row.engineer_user_id ? memberDisplayName(memberById.get(row.engineer_user_id)) : ""),
        render: (row) => (row.engineer_user_id ? memberDisplayName(memberById.get(row.engineer_user_id)) : "—"),
      },
      {
        id: "quantity",
        header: "Quantity",
        align: "end",
        sortValue: (row) => Number(row.quantity),
        render: (row) => formatNumberWeb(Number(row.quantity)),
      },
      {
        id: "price",
        header: "Unit price",
        align: "end",
        sortValue: (row) => Number(row.unit_price),
        render: (row) => formatMoneyWeb(Number(row.unit_price)),
      },
      {
        id: "purchase",
        header: "Purchase price",
        align: "end",
        sortValue: (row) => row.article?.purchase_price ?? null,
        render: (row) => (row.article?.purchase_price != null ? formatMoneyWeb(row.article.purchase_price) : "—"),
      },
      {
        id: "vat",
        header: "VAT",
        align: "end",
        sortValue: (row) => (row.article?.vat_rate ? Number(row.article.vat_rate.value) : null),
        render: (row) => row.article?.vat_rate?.label ?? "—",
      },
      {
        id: "discount",
        header: "Discount",
        align: "end",
        sortValue: (row) => Number(row.discount_percent),
        render: (row) => (Number(row.discount_percent) > 0 ? `${formatNumberWeb(Number(row.discount_percent))}%` : "—"),
      },
      {
        id: "net",
        header: "Net unit price",
        align: "end",
        sortValue: (row) => netUnitPrice(row),
        render: (row) => formatMoneyWeb(netUnitPrice(row)),
      },
      {
        id: "total",
        header: "Total",
        align: "end",
        sortValue: (row) => lineTotal(row),
        render: (row) => formatMoneyWeb(lineTotal(row)),
      },
    ],
    [assetById, memberById],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "asset",
        label: "Asset",
        getOptions: (row: QuoteLineItemRecord) => {
          if (!row.asset_id) return [{ value: NO_ASSET, label: "No asset" }];
          const asset = assetById.get(row.asset_id);
          return [{ value: row.asset_id, label: asset ? assetLabel(asset) : "Unknown asset" }];
        },
      },
      {
        id: "engineer",
        label: "Engineer",
        getOptions: (row: QuoteLineItemRecord) =>
          row.engineer_user_id
            ? [{ value: row.engineer_user_id, label: memberDisplayName(memberById.get(row.engineer_user_id)) }]
            : [{ value: NO_ASSET, label: "No engineer" }],
      },
    ],
    [assetById, memberById],
  );

  const segment = useMemo(
    () => ({
      label: "Show line items",
      defaultValue: "all",
      options: [
        { value: "articles", label: "Articles", match: (row: QuoteLineItemRecord) => Boolean(row.article_id) },
        { value: "manual", label: "Manual", match: (row: QuoteLineItemRecord) => !row.article_id },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: QuoteLineItemRecord): WebMenuItem[] => {
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
        meta={String(lineItems.length)}
        rows={lineItems}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.article_number ?? ""} ${row.description}`}
        noun="line items"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="lines"
        defaultSort={{ columnId: "number", direction: "asc" }}
        rowActions={canUpdate || canDelete ? rowActions : undefined}
        rowLabel={(row) => row.article_number ?? row.description}
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setDialog({ row: null })}>
              + Line
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Line to add the priced items that make up this quote." : undefined}
      />

      {dialog ? (
        <LineItemDialog
          key={dialog.row?.id ?? "new"}
          quoteId={quoteId}
          row={dialog.row}
          articles={articles}
          clientAssets={clientAssets}
          members={members}
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
        {deleting ? <strong>{deleting.description}</strong> : null} is removed from the quote. This cannot be undone.
      </WebConfirmDialog>
    </div>
  );
}

function LineItemDialog({
  quoteId,
  row,
  articles,
  clientAssets,
  members,
  onClose,
}: {
  quoteId: string;
  row: QuoteLineItemRecord | null;
  articles: ArticleSelectOption[];
  clientAssets: AssetRecord[];
  members: OrgMemberRecord[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(row?.article_id ?? "");
  const [articleNumber, setArticleNumber] = useState(row?.article_number ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [assetId, setAssetId] = useState(row?.asset_id ?? "");
  const [engineerId, setEngineerId] = useState(row?.engineer_user_id ?? "");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "1");
  const [unitPrice, setUnitPrice] = useState(row ? String(row.unit_price) : "");
  const [discount, setDiscount] = useState(row ? String(row.discount_percent ?? 0) : "0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  // Only engineer-role members are a valid `engineer_user_id`.
  const engineers = useMemo(() => members.filter((member) => member.role === "engineer"), [members]);

  const articleOptions = useMemo<ComboboxOption[]>(
    () =>
      articles.map((article) => ({
        value: article.id,
        label: `${article.article_number} — ${article.description}`,
        keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
      })),
    [articles],
  );
  const assetOptions = useMemo<ComboboxOption[]>(
    () =>
      clientAssets.map((asset) => ({
        value: asset.id,
        label: assetLabel(asset),
        keywords: asset.serial_number ?? undefined,
      })),
    [clientAssets],
  );

  // Read-only purchase price / VAT of the linked article (the saved row's own
  // embed covers an article that has since been deactivated).
  const active = articleId ? articleById.get(articleId) : undefined;
  const info = active
    ? {
        purchase: active.purchase_price,
        vat: active.vat_rate_percent !== null ? `${active.vat_rate_percent}%` : "—",
      }
    : row && row.article_id === articleId && row.article
      ? { purchase: row.article.purchase_price, vat: row.article.vat_rate?.label ?? "—" }
      : null;

  // Picking an article proposes its number, description and sale price.
  function handleArticleChange(id: string) {
    setArticleId(id);
    const picked = id ? articleById.get(id) : undefined;
    if (picked) {
      setArticleNumber(picked.article_number);
      setDescription(picked.description);
      setUnitPrice(picked.sale_price === null ? "" : String(picked.sale_price));
    }
  }

  async function handleSave() {
    const parsedQuantity = Number(quantity.replace(",", "."));
    const parsedPrice = Number(unitPrice.replace(",", "."));
    const parsedDiscount = discount.trim() === "" ? 0 : Number(discount.replace(",", "."));
    if (!description.trim()) {
      setError("Enter a description, or pick an article");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero");
      return;
    }
    if (!unitPrice.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("Enter a unit price of 0 or more");
      return;
    }
    if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
      setError("Enter a discount between 0 and 100");
      return;
    }
    setError(null);
    setSaving(true);
    // `null` (not `undefined`) for an emptied picker: the dialog always holds
    // the row's full current state, so empty means "cleared" (see
    // `clearableUuid` in `../schema.ts`).
    const input = {
      description: description.trim(),
      articleNumber: articleNumber.trim(),
      quantity: parsedQuantity,
      unitPrice: parsedPrice,
      discountPercent: parsedDiscount,
      assetId: assetId || null,
      articleId: articleId || null,
      engineerUserId: engineerId || null,
    };
    const result = row ? await updateQuoteLineItem(row.id, input) : await createQuoteLineItem(quoteId, input);
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
          <label className="web-field-label" htmlFor="quote-line-article">
            Article
          </label>
          <Combobox
            id="quote-line-article"
            options={articleOptions}
            value={articleId}
            onChange={handleArticleChange}
            placeholder="Search article number, EAN, GTIN…"
            emptyMessage="No matching articles"
            clearable
          />
          {info ? (
            <span className="web-figure-hint">
              Purchase price {info.purchase !== null ? formatMoneyWeb(info.purchase) : "—"} · VAT {info.vat}
            </span>
          ) : null}
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-number">
            Article number
          </label>
          <input
            id="quote-line-number"
            className="web-input"
            data-mono="true"
            placeholder="Optional"
            value={articleNumber}
            onChange={(event) => setArticleNumber(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-description">
            Description
          </label>
          <input
            id="quote-line-description"
            className="web-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-asset">
            Asset
          </label>
          <Combobox
            id="quote-line-asset"
            options={assetOptions}
            value={assetId}
            onChange={setAssetId}
            placeholder="No specific asset"
            emptyMessage="No matching assets"
            clearable
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-engineer">
            Engineer
          </label>
          <select
            id="quote-line-engineer"
            className="web-select"
            value={engineerId}
            onChange={(event) => setEngineerId(event.target.value)}
          >
            <option value="">No engineer</option>
            {engineers.map((engineer) => (
              <option key={engineer.id} value={engineer.id}>
                {memberDisplayName(engineer)}
              </option>
            ))}
          </select>
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-quantity">
            Quantity
          </label>
          <input
            id="quote-line-quantity"
            className="web-input"
            type="number"
            step="0.01"
            min="0.01"
            data-numeric="true"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-price">
            Unit price
          </label>
          <input
            id="quote-line-price"
            className="web-input"
            type="number"
            step="0.01"
            min="0"
            data-numeric="true"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="quote-line-discount">
            Discount %
          </label>
          <input
            id="quote-line-discount"
            className="web-input"
            type="number"
            step="0.01"
            min="0"
            max="100"
            data-numeric="true"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </div>
      </div>
    </WebConfirmDialog>
  );
}
