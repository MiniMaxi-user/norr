"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  createWorkOrderArticle,
  deleteWorkOrderArticle,
  updateWorkOrderArticle,
  type WorkOrderArticleRecord,
} from "../work-order-articles-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import { effectiveSalePrice } from "./work-order-article-price";

export interface WorkOrderMaterialsPanelProps {
  workOrderId: string;
  workOrderArticles: WorkOrderArticleRecord[];
  articles: ArticleSelectOption[];
  canCreate: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
  currentUserId?: string;
  /** Checked out in the field: material can only be changed in the PWA. */
  locked?: boolean;
}

const lineTotal = (row: WorkOrderArticleRecord) => row.quantity * (effectiveSalePrice(row) ?? 0);

/**
 * Materials tab (design system, issue #222): the articles consumed on this
 * work order as one card with a FilterBar and a table. `+ Article` at the
 * right of the FilterBar opens the same small dialog as before; Edit / Delete
 * live in one ··· menu per row. Quantities, unit prices and totals are
 * right-aligned figures; a line covered by the contract says so in plain
 * text (no badge per row).
 */
export function WorkOrderMaterialsPanel({
  workOrderId,
  workOrderArticles,
  articles,
  canCreate,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
  currentUserId,
  locked = false,
}: WorkOrderMaterialsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ row: WorkOrderArticleRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<WorkOrderArticleRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const total = workOrderArticles.reduce((sum, row) => sum + lineTotal(row), 0);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteWorkOrderArticle(deleting.id);
    setDeletePending(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<WorkOrderArticleRecord>[]>(
    () => [
      {
        id: "number",
        header: "Article",
        mono: true,
        sortValue: (row) => row.article?.article_number ?? "",
        render: (row) => (row.article_id && row.article?.article_number ? <Link href={`/articles/${row.article_id}`}>{row.article?.article_number}</Link> : row.article?.article_number ?? "—"),
      },
      {
        id: "description",
        header: "Description",
        sortValue: (row) => row.article?.description ?? "",
        render: (row) => row.article?.description ?? "—",
      },
      {
        id: "billing",
        header: "Billing",
        sortValue: (row) => (row.covered_by_contract ? "Covered by contract" : "Billable"),
        render: (row) => (row.covered_by_contract ? "Covered by contract" : "Billable"),
      },
      {
        id: "quantity",
        header: "Quantity",
        align: "end",
        sortValue: (row) => row.quantity,
        render: (row) => formatNumberWeb(row.quantity),
      },
      {
        id: "price",
        header: "Unit price",
        align: "end",
        sortValue: (row) => effectiveSalePrice(row),
        render: (row) => formatMoneyWeb(effectiveSalePrice(row)),
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
        id: "billing",
        label: "Billing",
        getOptions: (row: WorkOrderArticleRecord) => [
          row.covered_by_contract
            ? { value: "covered", label: "Covered by contract" }
            : { value: "billable", label: "Billable" },
        ],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show material",
      defaultValue: "all",
      options: [
        { value: "billable", label: "Billable", match: (row: WorkOrderArticleRecord) => !row.covered_by_contract },
        { value: "covered", label: "Covered", match: (row: WorkOrderArticleRecord) => row.covered_by_contract },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: WorkOrderArticleRecord): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (canUpdateAny || (canUpdateOwn && row.created_by === currentUserId)) {
      items.push({ key: "edit", label: "Edit…", onSelect: () => setDialog({ row }) });
    }
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
        title="Material"
        meta={`${workOrderArticles.length} · ${formatMoneyWeb(total)}`}
        rows={workOrderArticles}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.article?.article_number ?? ""} ${row.article?.description ?? ""}`}
        noun="articles"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="material"
        defaultSort={{ columnId: "number", direction: "asc" }}
        rowActions={rowActions}
        rowLabel={(row) => row.article?.article_number ?? "article"}
        note={locked ? "Checked out by the engineer — material can only be changed in the field app." : undefined}
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setDialog({ row: null })}>
              + Article
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Article to log the first material." : undefined}
      />

      {dialog ? (
        <ArticleDialog
          key={dialog.row?.id ?? "new"}
          workOrderId={workOrderId}
          row={dialog.row}
          articles={articles}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <WebConfirmDialog
        open={Boolean(deleting)}
        title="Delete article?"
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deletePending}
        error={deleteError}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        This consumed article is removed from the work order. This cannot be undone.
      </WebConfirmDialog>
    </div>
  );
}

function ArticleDialog({
  workOrderId,
  row,
  articles,
  onClose,
}: {
  workOrderId: string;
  row: WorkOrderArticleRecord | null;
  articles: ArticleSelectOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(row?.article_id ?? "");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type-to-filter by article number/description; EAN/GTIN/MPN are searchable
  // too but never shown in the label.
  const articleOptions: ComboboxOption[] = articles.map((article) => ({
    value: article.id,
    label: `${article.article_number} — ${article.description}`,
    keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
  }));

  async function handleSave() {
    const parsedQuantity = Number(quantity.replace(",", "."));
    if (!articleId) {
      setError("Choose an article");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero");
      return;
    }
    setError(null);
    setSaving(true);
    const result = row
      ? await updateWorkOrderArticle(row.id, { articleId, quantity: parsedQuantity })
      : await createWorkOrderArticle(workOrderId, { articleId, quantity: parsedQuantity });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not save this consumed article.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open
      title={row ? "Edit consumed article" : "Add article"}
      confirmLabel="Save"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="wo-article">
            Article
          </label>
          <Combobox
            id="wo-article"
            options={articleOptions}
            value={articleId}
            onChange={setArticleId}
            placeholder="Search by article number or description…"
            emptyMessage="No matching articles"
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="wo-article-quantity">
            Quantity
          </label>
          <input
            id="wo-article-quantity"
            className="web-input"
            type="number"
            step="0.001"
            min="0.001"
            data-numeric="true"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
      </div>
    </WebConfirmDialog>
  );
}
