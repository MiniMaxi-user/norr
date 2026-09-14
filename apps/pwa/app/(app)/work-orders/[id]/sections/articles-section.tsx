"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, IconButton, Inline, Stack, Text } from "@yourorg/ui";
import { Boxes, Minus, Plus } from "@yourorg/ui/icons";
import { removeLocalArticle, updateLocalArticleQuantity, type LocalArticle } from "@/lib/offline/db";
import type { WorkOrderArticleEntry } from "@/lib/work-orders/types";
import { ArticleCatalogSheet } from "../article-catalog-sheet";
import { SwipeableRow } from "./swipeable-row";

/**
 * The "Articles" tab (issue #170, IMPLEMENTATION.md §4) — server-synced
 * `work_order_articles` rows (read-only here, same reasoning as
 * `hours-section.tsx`) plus this device's own local, not-yet-synced
 * additions, in one list. Only local rows are removable — removing a
 * server-synced row would be a write against the server, out of scope for
 * this story (`/api/work-orders/[id]`'s own doc comment). Removal is
 * swipe-to-delete (product feedback, 2026-09-14 — matches the Hours tab's
 * `SwipeableRow` gesture instead of a standalone cross/X button); a
 * server-synced row gets no `onDelete`, so `SwipeableRow` renders it inert
 * (no reveal, no drag), same convention `hours-section.tsx` uses.
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

  async function handleQuantityChange(id: number | undefined, delta: number) {
    if (id === undefined) return;
    await updateLocalArticleQuantity(id, delta);
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
              <SwipeableRow key={article.id}>
                <ArticleRow
                  quantity={article.quantity}
                  description={article.description}
                  articleNumber={article.articleNumber}
                />
              </SwipeableRow>
            ))}
            {localArticles.map((article) => (
              <SwipeableRow key={article.id} onDelete={() => void handleRemove(article.id)}>
                <ArticleRow
                  quantity={article.quantity}
                  description={article.description}
                  articleNumber={article.articleNumber}
                  onQuantityChange={(delta) => void handleQuantityChange(article.id, delta)}
                />
              </SwipeableRow>
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

const quantityBadgeStyle = {
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
} as const;

function ArticleRow({
  quantity,
  description,
  articleNumber,
  onQuantityChange,
}: {
  quantity: number;
  description: string;
  articleNumber: string;
  /** Only passed for local (not-yet-synced) rows — see this file's own doc
   * comment on why server-synced rows stay read-only. Tapping the plain
   * quantity badge reveals a "+"-before/"-"-after stepper in its place. */
  onQuantityChange?: (delta: number) => void;
}) {
  const [stepperOpen, setStepperOpen] = useState(false);
  const stepperRef = useRef<HTMLDivElement>(null);

  // Click/tap anywhere outside the open stepper collapses it back to the
  // plain quantity badge — same "outside" concept `AddWarehouseArticleCombobox`
  // (web app) uses for its own dropdown, simpler here since there's nothing
  // to select, just a reveal/hide toggle.
  useEffect(() => {
    if (!stepperOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!stepperRef.current?.contains(event.target as Node)) setStepperOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [stepperOpen]);

  return (
    <Inline gap="sm" align="center">
      {!onQuantityChange ? (
        <span aria-hidden style={quantityBadgeStyle}>
          {quantity}
        </span>
      ) : stepperOpen ? (
        <div ref={stepperRef} style={{ display: "contents" }}>
          <Inline gap="xs" align="center">
            <IconButton
              variant="ghost"
              aria-label="Increase quantity"
              onClick={() => onQuantityChange(1)}
              style={{ width: 44, height: 44 }}
            >
              <Plus aria-hidden width={16} height={16} />
            </IconButton>
            <Text style={{ minWidth: "1.5em", textAlign: "center", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
              {quantity}
            </Text>
            <IconButton
              variant="ghost"
              aria-label="Decrease quantity"
              onClick={() => onQuantityChange(-1)}
              style={{ width: 44, height: 44 }}
            >
              <Minus aria-hidden width={16} height={16} />
            </IconButton>
          </Inline>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setStepperOpen(true)}
          aria-label={`Quantity ${quantity}, tap to adjust`}
          style={{ ...quantityBadgeStyle, color: "inherit", cursor: "pointer" }}
        >
          {quantity}
        </button>
      )}
      <Stack gap="xs">
        <Text>{description}</Text>
        <Text tone="muted">{articleNumber}</Text>
      </Stack>
    </Inline>
  );
}
