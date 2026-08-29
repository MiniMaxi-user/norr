"use client";

import { useState } from "react";
import { Badge, Button, Inline, Table, Text } from "@yourorg/ui";
import type { ArticleRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";
import { formatCurrency } from "@/lib/format/currency";
import { ArticleFormPanel } from "./article-form-panel";
import { DeleteArticleDialog } from "./delete-article-dialog";

export interface ArticlesTableProps {
  articles: ArticleRecord[];
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Articles list table (issue #92). Server-side filtering already narrows the
 * page (see `ArticlesFilters`) — this component is purely presentational
 * plus the row-level Edit/Delete affordances, same split `AssetsTable` uses.
 *
 * A row is only clickable (and only gets an Edit action) when `canEdit` —
 * unlike `AssetsTable`'s row click (which always navigates to a read-only
 * detail page regardless of edit rights), Articles has no separate detail
 * page: the slide-in `ArticleFormPanel` IS the only "see more" surface, and
 * it's a real editable form, not a read-only view. A read-only role
 * (planner/engineer/finance, per `lib/rbac/permissions.ts`'s `articles`
 * entry) already sees every field this table exposes inline; opening an
 * editable panel they can't actually save from would just invite a
 * `can()`-rejected submit.
 */
export function ArticlesTable({ articles, groups, units, manufacturers, vatRates, canEdit, canDelete }: ArticlesTableProps) {
  const [editingArticle, setEditingArticle] = useState<ArticleRecord | null>(null);
  const [deletingArticle, setDeletingArticle] = useState<ArticleRecord | null>(null);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Table stickyHeader maxHeight="65vh">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Image</Table.HeaderCell>
            <Table.HeaderCell>Article number</Table.HeaderCell>
            <Table.HeaderCell>Description</Table.HeaderCell>
            <Table.HeaderCell>Group</Table.HeaderCell>
            <Table.HeaderCell>Manufacturer</Table.HeaderCell>
            <Table.HeaderCell>Unit</Table.HeaderCell>
            <Table.HeaderCell>Purchase price</Table.HeaderCell>
            <Table.HeaderCell>Sale price</Table.HeaderCell>
            <Table.HeaderCell align="center">VAT</Table.HeaderCell>
            <Table.HeaderCell align="center">Status</Table.HeaderCell>
            {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {articles.map((article) => (
            <Table.Row key={article.id} onClick={canEdit ? () => setEditingArticle(article) : undefined}>
              <Table.Cell>
                {article.image_url ? (
                  // A small, arbitrary-origin tenant-supplied URL isn't a good
                  // fit for `next/image`'s remote-pattern allowlist; same
                  // plain-`<img>` treatment this module's own live preview
                  // (`article-form-panel.tsx`) uses.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={article.image_url}
                    alt=""
                    style={{ width: "2rem", height: "2rem", objectFit: "cover", borderRadius: "0.25rem" }}
                  />
                ) : (
                  <Text tone="muted">—</Text>
                )}
              </Table.Cell>
              <Table.Cell>{article.article_number}</Table.Cell>
              <Table.Cell>{article.description}</Table.Cell>
              <Table.Cell>{article.article_group?.name ?? "—"}</Table.Cell>
              <Table.Cell>{article.article_manufacturer?.label ?? "—"}</Table.Cell>
              <Table.Cell>{article.article_unit?.label ?? "—"}</Table.Cell>
              <Table.Cell>{formatCurrency(article.purchase_price)}</Table.Cell>
              <Table.Cell>{formatCurrency(article.sale_price)}</Table.Cell>
              <Table.Cell align="center">{article.vat_rate ? `${article.vat_rate.value}%` : "—"}</Table.Cell>
              <Table.Cell align="center">
                <Inline gap="xs" justify="center">
                  {article.is_composite && <Badge variant="accent">Composite</Badge>}
                  <Badge variant={article.is_active ? "success" : "muted"}>{article.is_active ? "Active" : "Inactive"}</Badge>
                </Inline>
              </Table.Cell>
              {showActionsColumn && (
                <Table.Cell align="center">
                  <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                    {canEdit && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingArticle(article)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button type="button" variant="danger" size="sm" onClick={() => setDeletingArticle(article)}>
                        Delete
                      </Button>
                    )}
                  </span>
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {editingArticle && (
        <ArticleFormPanel
          mode="edit"
          article={editingArticle}
          groups={groups}
          units={units}
          manufacturers={manufacturers}
          vatRates={vatRates}
          open
          onOpenChange={(next) => !next && setEditingArticle(null)}
        />
      )}

      {deletingArticle && (
        <DeleteArticleDialog article={deletingArticle} open onOpenChange={(next) => !next && setDeletingArticle(null)} />
      )}
    </>
  );
}
