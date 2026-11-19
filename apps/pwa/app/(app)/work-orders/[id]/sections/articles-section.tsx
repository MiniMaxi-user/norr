"use client";

import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@yourorg/ui";
import { PwaStack, WebButton, WebCard } from "@yourorg/ui/web";
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
    <PwaStack>
      {isEmpty ? (
        <EmptyState icon={<Boxes />} heading="No articles added yet." />
      ) : (
        <WebCard size="touch" title="Articles">
          <div className="pwa-list">
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
          </div>
        </WebCard>
      )}

      {/* The add button sits BELOW the list, full width, secondary. */}
      <WebButton size="touch" block onClick={() => setCatalogOpen(true)}>
        <Plus aria-hidden />
        Add article
      </WebButton>

      <ArticleCatalogSheet
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        workOrderId={workOrderId}
        currentUserId={currentUserId}
        localArticles={localArticles}
        onAdded={onLocalArticlesChange}
      />
    </PwaStack>
  );
}

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
   * quantity box reveals a "+"-before/"-"-after stepper in its place. */
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
    <div className="pwa-list-row">
      {!onQuantityChange ? (
        <span aria-hidden className="pwa-qty">
          {quantity}×
        </span>
      ) : stepperOpen ? (
        <div ref={stepperRef} className="pwa-stepper">
          <button
            type="button"
            className="pwa-icon-btn"
            aria-label="Increase quantity"
            onClick={() => onQuantityChange(1)}
          >
            <Plus aria-hidden width={16} height={16} />
          </button>
          <span className="pwa-stepper-value">{quantity}</span>
          <button
            type="button"
            className="pwa-icon-btn"
            aria-label="Decrease quantity"
            onClick={() => onQuantityChange(-1)}
          >
            <Minus aria-hidden width={16} height={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pwa-qty"
          onClick={() => setStepperOpen(true)}
          aria-label={`Quantity ${quantity}, tap to adjust`}
        >
          {quantity}×
        </button>
      )}
      <span className="pwa-list-main">
        <span className="pwa-list-title">{description}</span>
        <span className="pwa-list-sub">{articleNumber}</span>
      </span>
    </div>
  );
}
