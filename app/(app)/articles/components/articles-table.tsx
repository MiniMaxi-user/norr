"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Inline, Table, Text } from "@yourorg/ui";
import type { ArticleRecord } from "../actions";
import { formatCurrency } from "@/lib/format/currency";
import { DeleteArticleDialog } from "./delete-article-dialog";

export interface ArticlesTableProps {
  articles: ArticleRecord[];
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Articles list table (issue #92, converted off the slide-in `ArticleFormPanel`
 * by issue #123 — "Article popup"). Server-side filtering already narrows the
 * page (see `ArticlesFilters`) — this component is purely presentational plus
 * the row-level navigation/Delete affordance, same split `AssetsTable` uses.
 *
 * A row now ALWAYS navigates to the real `/articles/[id]` detail page (same
 * "always navigates, regardless of edit rights" convention `AssetsTable`'s
 * own row click uses) — unlike before issue #123, when Articles had no
 * detail page of its own and a row was only clickable (with an Edit action)
 * for a caller who could actually edit. A read-only role (planner/engineer/
 * finance) now gets the same real read-only detail screen `ArticleScreen`
 * renders for them (`readOnly`, gated server-side by `[id]/article-detail-loader.ts`),
 * instead of simply having no "see more" surface at all.
 */
export function ArticlesTable({ articles, canEdit, canDelete }: ArticlesTableProps) {
  const router = useRouter();
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
            <Table.Row key={article.id} onClick={() => router.push(`/articles/${article.id}`)}>
              <Table.Cell>
                {article.image_url ? (
                  // A small, arbitrary-origin tenant-supplied URL isn't a good
                  // fit for `next/image`'s remote-pattern allowlist; same
                  // plain-`<img>` treatment the detail screen's own `MediaTile`
                  // (`@yourorg/ui`) uses.
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/articles/${article.id}/edit`)}
                      >
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

      {deletingArticle && (
        <DeleteArticleDialog article={deletingArticle} open onOpenChange={(next) => !next && setDeletingArticle(null)} />
      )}
    </>
  );
}
