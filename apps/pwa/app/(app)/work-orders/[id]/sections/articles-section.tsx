"use client";

import { useState } from "react";
import { Button, Card, EmptyState, IconButton, Inline, Stack, Text } from "@yourorg/ui";
import { Boxes, Plus, X } from "@yourorg/ui/icons";
import { removeLocalArticle, type LocalArticle } from "@/lib/offline/db";
import type { WorkOrderArticleEntry } from "@/lib/work-orders/types";
import { ArticleCatalogSheet } from "../article-catalog-sheet";

/**
 * The "Articles" tab (issue #170, IMPLEMENTATION.md §4) — server-synced
 * `work_order_articles` rows (read-only here, same reasoning as
 * `hours-section.tsx`) plus this device's own local, not-yet-synced
 * additions, in one list. Only local rows get a remove button — removing a
 * server-synced row would be a write against the server, out of scope for
 * this story (`/api/work-orders/[id]`'s own doc comment).
 */
export function ArticlesSection({
  workOrderId,
  currentUserId,
  serverArticles,
  localArticles,
  onLocalArticlesChange,
}: {
  workOrderId: string;
  currentUserId: string;
  serverArticles: WorkOrderArticleEntry[];
  localArticles: LocalArticle[];
  onLocalArticlesChange: () => void | Promise<void>;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);

  async function handleRemove(id: number | undefined) {
    if (id === undefined) return;
    await removeLocalArticle(id);
    await onLocalArticlesChange();
  }

  const isEmpty = serverArticles.length === 0 && localArticles.length === 0;

  return (
    <Stack gap="md">
      {isEmpty ? (
        <EmptyState icon={<Boxes />} heading="No articles added yet." />
      ) : (
        <Card>
          <Stack gap="sm">
            {serverArticles.map((article) => (
              <ArticleRow
                key={article.id}
                quantity={article.quantity}
                description={article.description}
                articleNumber={article.articleNumber}
              />
            ))}
            {localArticles.map((article) => (
              <ArticleRow
                key={article.id}
                quantity={article.quantity}
                description={article.description}
                articleNumber={article.articleNumber}
                onRemove={() => void handleRemove(article.id)}
              />
            ))}
          </Stack>
        </Card>
      )}

      <Button variant="outline" fullWidth onClick={() => setCatalogOpen(true)} style={{ minHeight: 44 }}>
        <Inline gap="xs" align="center" justify="center">
          <Plus aria-hidden width={16} height={16} />
          Add article
        </Inline>
      </Button>

      <ArticleCatalogSheet
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        workOrderId={workOrderId}
        currentUserId={currentUserId}
        localArticles={localArticles}
        onAdded={onLocalArticlesChange}
      />
    </Stack>
  );
}

function ArticleRow({
  quantity,
  description,
  articleNumber,
  onRemove,
}: {
  quantity: number;
  description: string;
  articleNumber: string;
  onRemove?: () => void;
}) {
  return (
    <Inline justify="between" align="center" gap="sm">
      <Inline gap="sm" align="center">
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: "var(--ui-radius-md)",
            background: "var(--ui-surface-hover)",
            border: "1px solid var(--ui-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 650,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {quantity}
        </span>
        <Stack gap="xs">
          <Text>{description}</Text>
          <Text tone="muted">{articleNumber}</Text>
        </Stack>
      </Inline>
      {onRemove && (
        <IconButton variant="ghost" aria-label="Remove article" onClick={onRemove} style={{ width: 44, height: 44 }}>
          <X aria-hidden />
        </IconButton>
      )}
    </Inline>
  );
}
