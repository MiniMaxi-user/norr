"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Callout, Dialog, EmptyState, IconButton, Input, Skeleton, Stack, Text } from "@yourorg/ui";
import { AlertTriangle, Boxes, X } from "@yourorg/ui/icons";
import { addLocalArticle, getCachedCatalog, type LocalArticle } from "@/lib/offline/db";
import type { CatalogArticle } from "@/lib/work-orders/types";

/** Unfiltered rows shown before the engineer types a search query — this
 * sheet's catalog is already scoped to just the engineer's own stocked
 * articles (`/api/articles/catalog`'s own doc comment), but even that list
 * can run long, so it opens narrowed to a short, scannable slice rather than
 * the full list, same reasoning `StockSheet` documents for its own search
 * box (`_nav/stock-sheet.tsx`). */
const DEFAULT_RESULT_LIMIT = 10;

/**
 * "Add article" bottom sheet (issue #170, IMPLEMENTATION.md §4) — the
 * org's article catalog (`/api/articles/catalog`), tap a row to add one;
 * tapping the same row again increments its quantity rather than adding a
 * duplicate (`addLocalArticle`'s own behavior, see `lib/offline/db.ts`).
 * Stays open across multiple taps (closed only via the header's close
 * button or the overlay) so adding several different articles for one job
 * doesn't require re-opening the sheet each time.
 *
 * Bug report, 2026-09-13: this used to have NO offline fallback at all — a
 * bare error every time it opened without a network. `today-screen.tsx`'s
 * sync now warms `lib/offline/db.ts`'s `catalog` table (tenant reference
 * data, rarely changes) alongside its per-work-order prefetching; a failed
 * live fetch here falls back to that cache the same way `today-screen.tsx`/
 * `work-order-detail.tsx` already fall back to their own caches.
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
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  // Reset the search box every time the sheet reopens — a stale query from
  // the previous open never carries over.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || catalog !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/articles/catalog");
        if (!response.ok) throw new Error("Failed to load catalog");
        const data = (await response.json()) as { articles: CatalogArticle[] };
        if (!cancelled) {
          setCatalog(data.articles);
          setOffline(false);
        }
      } catch {
        const cached = await getCachedCatalog(currentUserId);
        if (cancelled) return;
        if (cached.length > 0) {
          setCatalog(cached);
          setOffline(true);
        } else {
          setError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, catalog, currentUserId]);

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

  // No query: a short, scannable slice (`DEFAULT_RESULT_LIMIT`) rather than
  // the full catalog. With a query: every match across description/article
  // number, and ONLY matches — never the unfiltered list alongside them.
  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, DEFAULT_RESULT_LIMIT);
    return catalog.filter(
      (article) => article.description.toLowerCase().includes(q) || article.articleNumber.toLowerCase().includes(q),
    );
  }, [catalog, query]);

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
        <Stack gap="md">
          <Input
            type="search"
            placeholder="Search by article number or name"
            aria-label="Search articles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {offline && catalog !== null && catalog.length > 0 && (
            <Callout icon={AlertTriangle}>Showing the last synced catalog — couldn&apos;t refresh.</Callout>
          )}
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
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              heading={catalog.length === 0 ? "No articles in the catalog yet." : "No articles found."}
            />
          ) : (
            <Stack gap="xs">
              {filtered.map((article) => {
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
        </Stack>
      </Dialog.Body>
    </Dialog>
  );
}
