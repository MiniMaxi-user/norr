"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusText, WebDataTableCard, type FilterOption, type WebColumn } from "@yourorg/ui/web-client";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleRecord } from "../actions";
import { ARTICLES_PAGE_SIZE } from "./articles-query";
import { DeleteArticleDialog } from "./delete-article-dialog";

const STATUS_SEGMENT = {
  label: "Status",
  defaultValue: "active",
  options: [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
    { value: "all", label: "All" },
  ] as const,
};

/**
 * The Articles list table (list-page shell, issue #222): a `WebDataTableCard`
 * in server mode. `listArticles` (driven by the `q`, `groupId`,
 * `manufacturerItemId`, `composite`, `seg`, `sort`, `dir` and `page` URL
 * params) returns the filtered page; this component only renders it. Row
 * actions (Open, Edit, Delete) live in one ··· menu.
 */
export function ArticlesTableCard({
  articles,
  total,
  page,
  unfilteredTotal,
  groups,
  manufacturers,
  canCreate,
  canEdit,
  canDelete,
}: {
  articles: ArticleRecord[];
  total: number;
  page: number;
  unfilteredTotal?: number;
  groups: FilterOption[];
  manufacturers: FilterOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ArticleRecord | null>(null);

  const columns = useMemo<WebColumn<ArticleRecord>[]>(
    () => [
      { id: "number", header: "Article number", primary: true, mono: true, sortable: true, render: (a) => a.article_number },
      {
        id: "description",
        header: "Description",
        sortable: true,
        render: (a) => (
          <>
            {a.description}
            {a.is_composite ? <StatusText tone="info"> · Composite</StatusText> : null}
          </>
        ),
      },
      { id: "group", header: "Group", render: (a) => a.article_group?.name ?? null },
      { id: "manufacturer", header: "Manufacturer", render: (a) => a.article_manufacturer?.label ?? null },
      { id: "unit", header: "Unit", render: (a) => a.article_unit?.label ?? null },
      {
        id: "purchase",
        header: "Purchase price",
        align: "end",
        sortable: true,
        render: (a) => (a.purchase_price === null ? null : formatCurrency(a.purchase_price)),
      },
      {
        id: "sale",
        header: "Sale price",
        align: "end",
        sortable: true,
        render: (a) => (a.sale_price === null ? null : formatCurrency(a.sale_price)),
      },
      { id: "vat", header: "VAT", align: "end", render: (a) => (a.vat_rate ? `${a.vat_rate.value}%` : null) },
      {
        id: "status",
        header: "Status",
        render: (a) => <StatusText display="auto" tone={a.is_active ? "success" : "neutral"}>{a.is_active ? "Active" : "Inactive"}</StatusText>,
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      { id: "groupId", label: "Group", options: groups },
      { id: "manufacturerItemId", label: "Manufacturer", options: manufacturers },
      {
        id: "composite",
        label: "Type",
        options: [
          { value: "1", label: "Composite" },
          { value: "0", label: "Plain" },
        ],
      },
    ],
    [groups, manufacturers],
  );

  return (
    <>
      <WebDataTableCard<ArticleRecord>
        rows={articles}
        getRowKey={(a) => a.id}
        columns={columns}
        noun="articles"
        dropdowns={dropdowns}
        segment={STATUS_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: ARTICLES_PAGE_SIZE }}
        defaultSort={{ columnId: "number", direction: "asc" }}
        rowHref={(a) => `/articles/${a.id}`}
        rowLabel={(a) => a.article_number}
        rowActions={(a) => [
          { key: "open", label: "Open", href: `/articles/${a.id}` },
          ...(canEdit ? [{ key: "edit", label: "Edit", href: `/articles/${a.id}/edit` }] : []),
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeleteTarget(a) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/articles/new" className="web-rail-link">
              Create article
            </Link>
          ) : null
        }
      />
      {canDelete ? (
        <DeleteArticleDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          article={deleteTarget}
        />
      ) : null}
    </>
  );
}
