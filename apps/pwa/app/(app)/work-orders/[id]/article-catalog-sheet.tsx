"use client";

import { useEffect, useState } from "react";
import { Badge, Callout, Dialog, EmptyState, IconButton, Skeleton, Stack, Text } from "@yourorg/ui";
import { AlertTriangle, Boxes, X } from "@yourorg/ui/icons";
import { addLocalArticle, type LocalArticle } from "@/lib/offline/db";
import type { CatalogArticle } from "@/lib/work-orders/types";

/**
 * "Add article" bottom sheet (issue #170, IMPLEMENTATION.md §4) — the
 * org's article catalog (`/api/articles/catalog`), tap a row to add one;
 * tapping the same row again increments its quantity rather than adding a
 * duplicate (`addLocalArticle`'s own behavior, see `lib/offline/db.ts`).
 * Stays open across multiple taps (closed only via the header's close
 * button or the overlay) so adding several different articles for one job
 * doesn't require re-opening the sheet each time.
 */
export function ArticleCatalogSheet({
  open,
  onOpenChange,
  workOrderId,
  currentUserId,
  localArticles,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  currentUserId: string;
  localArticles: LocalArticle[];
  onAdded: () => void | Promise<void>;
}) {
  const [catalog, setCatalog] = useState<CatalogArticle[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || catalog !== null) return;
    let cancelled = false;
    void fetch("/api/articles/catalog")
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load catalog");
        return response.json() as Promise<{ articles: CatalogArticle[] }>;
      })
      .then((data) => {
        if (!cancelled) setCatalog(data.articles);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, catalog]);

  async function handleAdd(article: CatalogArticle) {
    await addLocalArticle({
      workOrderId,
      userId: currentUserId,
      articleId: article.id,
      articleNumber: article.articleNumber,
      description: article.description,
    });
    await onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
      <Dialog.Header>
        <div className="ui-dialog-sheet-handle" />
        <Text style={{ fontWeight: 650 }}>Add article</Text>
        <IconButton variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
          <X aria-hidden />
        </IconButton>
      </Dialog.Header>
      <Dialog.Body>
        {error ? (
          <Callout icon={AlertTriangle}>
            Couldn&apos;t load the article catalog. Try again once you&apos;re online.
          </Callout>
        ) : catalog === null ? (
          <Stack gap="sm">
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </Stack>
        ) : catalog.length === 0 ? (
          <EmptyState icon={<Boxes />} heading="No articles in the catalog yet." />
        ) : (
          <Stack gap="xs">
            {catalog.map((article) => {
              const added = localArticles.find((row) => row.articleId === article.id);
              return (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => void handleAdd(article)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    minHeight: 56,
                    padding: "0 0.25rem",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--ui-surface-hover)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <Stack gap="xs">
                    <Text>{article.description}</Text>
                    <Text tone="muted">{article.articleNumber}</Text>
                  </Stack>
                  {added && <Badge variant="accent">×{added.quantity}</Badge>}
                </button>
              );
            })}
          </Stack>
        )}
      </Dialog.Body>
    </Dialog>
  );
}
