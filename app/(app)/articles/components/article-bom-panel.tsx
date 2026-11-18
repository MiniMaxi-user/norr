"use client";

import { useEffect, useMemo, useState } from "react";
import { Combobox, toast } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { StructureTree, WebConfirmDialog, type StructureTreeNode, type WebMenuItem } from "@yourorg/ui/web-client";
import { formatNumberWeb } from "@/lib/format/web";
import { listArticles, type ArticleRecord } from "../actions";
import type { ArticleComponentTreeNode } from "../component-tree";
import { addArticleComponent, removeArticleComponent, updateArticleComponent } from "../components-actions";

const CANDIDATE_FETCH_LIMIT = 200;

/** Number of components below the root, all levels (the Structure rail). */
export function bomComponentCount(tree: ArticleComponentTreeNode | undefined): number {
  if (!tree) return 0;
  function count(node: ArticleComponentTreeNode): number {
    return node.children.reduce((sum, child) => sum + 1 + count(child), 0);
  }
  return count(tree);
}

function quantityText(node: ArticleComponentTreeNode): string | null {
  if (node.componentId === null) return null;
  const unit = node.article.article_unit?.label;
  return `${formatNumberWeb(node.quantity)}${unit ? ` ${unit}` : ""}`;
}

export interface ArticleBomPanelProps {
  articleId: string;
  /** The full downward tree rooted at this article. */
  tree: ArticleComponentTreeNode | undefined;
  /** `can(actor, "articles", "create" | "update" | "delete")`. */
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** After add / remove / quantity change: refresh the page data. */
  onChange: () => void;
}

/**
 * "Bill of materials" tab of a composite article (issue #92/#124; StructureTree,
 * issue #222): this article's components, each of their components and so on,
 * arbitrarily deep, with the current article as the root. Adding a component,
 * changing its quantity and removing it act on this article's own (direct)
 * components — the rows one level down; deeper rows belong to another article's
 * bill of materials and are only opened (their own page edits them). Each action
 * is its own immediate save through the existing component actions, not part of
 * the page's Edit button.
 */
export function ArticleBomPanel({ articleId, tree, canCreate, canUpdate, canDelete, onChange }: ArticleBomPanelProps) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ rowId: string; name: string } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [quantityTarget, setQuantityTarget] = useState<{ rowId: string; name: string } | null>(null);
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [quantityPending, setQuantityPending] = useState(false);

  const directComponentIds = useMemo(
    () => new Set((tree?.children ?? []).map((child) => child.article.id)),
    [tree],
  );

  const nodes = useMemo<StructureTreeNode[]>(() => {
    if (!tree) return [];
    function convert(node: ArticleComponentTreeNode, depth: number): StructureTreeNode {
      const article = node.article;
      const actions: WebMenuItem[] = [];
      if (node.componentId !== null) actions.push({ key: "open", label: "Open article", href: `/articles/${article.id}` });
      if (depth === 0 && canCreate) {
        actions.push({ key: "add", label: "Add component…", onSelect: () => setAdding(true) });
      }
      if (depth === 1 && node.componentId !== null) {
        const rowId = node.componentId;
        if (canUpdate) {
          actions.push({
            key: "quantity",
            label: "Change quantity…",
            onSelect: () => {
              setQuantityError(null);
              setQuantityValue(String(node.quantity));
              setQuantityTarget({ rowId, name: article.article_number });
            },
          });
        }
        if (canDelete) {
          actions.push({ type: "separator", key: "sep" });
          actions.push({
            key: "remove",
            label: "Remove",
            danger: true,
            onSelect: () => {
              setRemoveError(null);
              setRemoving({ rowId, name: article.article_number });
            },
          });
        }
      }
      return {
        // A component can appear in several branches, so the BOM row id (not
        // the article id) keeps node ids unique.
        id: node.componentId ?? `root-${article.id}`,
        label: article.article_number,
        description: article.description,
        href: `/articles/${article.id}`,
        status: { label: article.is_active ? "Active" : "Inactive", tone: article.is_active ? "success" : "neutral" },
        quantity: quantityText(node),
        isCurrent: node.componentId === null,
        actions,
        children: node.children.map((child) => convert(child, depth + 1)),
      };
    }
    return [convert(tree, 0)];
  }, [tree, canCreate, canUpdate, canDelete]);

  async function confirmRemove() {
    if (!removing) return;
    setRemovePending(true);
    setRemoveError(null);
    const result = await removeArticleComponent(removing.rowId);
    setRemovePending(false);
    if (result.error || !result.data) {
      setRemoveError(result.error ?? "Could not remove this component. Try again.");
      return;
    }
    toast({ title: "Component removed", duration: 3000 });
    setRemoving(null);
    onChange();
  }

  async function confirmQuantity() {
    if (!quantityTarget) return;
    const parsed = Number(quantityValue.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setQuantityError("Enter a quantity greater than zero");
      return;
    }
    setQuantityPending(true);
    setQuantityError(null);
    const result = await updateArticleComponent(quantityTarget.rowId, { quantity: parsed });
    setQuantityPending(false);
    if (!result.data) {
      setQuantityError(result.error ?? "Could not change the quantity. Try again.");
      return;
    }
    toast({ title: "Quantity changed", duration: 3000 });
    setQuantityTarget(null);
    onChange();
  }

  return (
    <>
      <StructureTree
        title="Bill of materials"
        nodes={nodes}
        noun="articles"
        currentLabel="this article"
        childNoun="components"
        statusHeader="Status"
        showQuantity
        quantityHeader="Qty"
        ariaLabel="Article bill of materials"
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setAdding(true)}>
              + Component
            </WebButton>
          ) : undefined
        }
        emptyText="This article has no components."
        emptyAction={
          canCreate ? (
            <button type="button" className="web-rail-link" onClick={() => setAdding(true)}>
              Add component
            </button>
          ) : undefined
        }
      />

      {adding ? (
        <AddComponentDialog
          articleId={articleId}
          excludeIds={directComponentIds}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            toast({ title: "Component added", duration: 3000 });
            onChange();
          }}
        />
      ) : null}

      <WebConfirmDialog
        open={Boolean(removing)}
        title="Remove component?"
        confirmLabel="Remove"
        confirmVariant="danger"
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        {removing?.name} is removed from this bill of materials. The article itself is kept.
      </WebConfirmDialog>

      <WebConfirmDialog
        open={Boolean(quantityTarget)}
        title="Change quantity"
        confirmLabel="Save"
        confirmVariant="save"
        pending={quantityPending}
        error={quantityError}
        onCancel={() => setQuantityTarget(null)}
        onConfirm={() => void confirmQuantity()}
      >
        <label className="web-field-label" htmlFor="bom-quantity">
          Quantity of {quantityTarget?.name}
        </label>
        <input
          id="bom-quantity"
          className="web-input"
          inputMode="decimal"
          data-numeric="true"
          value={quantityValue}
          onChange={(event) => setQuantityValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void confirmQuantity();
          }}
        />
      </WebConfirmDialog>
    </>
  );
}

/**
 * Picks a component article + quantity. The picker is a `Combobox` over this
 * org's non-composite articles, fetched once when the dialog opens
 * (`listArticles({ isComposite: false, limit: 200 })`) — `Combobox` filters a
 * full option list client-side, so a catalog above 200 articles would need a
 * server-side search (unchanged limitation of the previous editor).
 */
function AddComponentDialog({
  articleId,
  excludeIds,
  onClose,
  onAdded,
}: {
  articleId: string;
  excludeIds: ReadonlySet<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [candidates, setCandidates] = useState<ArticleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [componentId, setComponentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listArticles({ isComposite: false, limit: CANDIDATE_FETCH_LIMIT })
      .then((result) => {
        if (!cancelled) setCandidates(result.data?.articles ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.id !== articleId && !excludeIds.has(candidate.id))
        .map((candidate) => ({
          value: candidate.id,
          label: `${candidate.article_number} — ${candidate.description}`,
          keywords: [candidate.ean, candidate.gtin, candidate.mpn].filter(Boolean).join(" "),
        })),
    [candidates, articleId, excludeIds],
  );

  async function handleSave() {
    if (!componentId) {
      setError("Select a component article");
      return;
    }
    const parsed = Number(quantity.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a quantity greater than zero");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await addArticleComponent(articleId, { componentArticleId: componentId, quantity: parsed });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not add this component.");
      return;
    }
    onAdded();
  }

  return (
    <WebConfirmDialog
      open
      title="Add component"
      confirmLabel="Add"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="bom-component">
            Component
          </label>
          <Combobox
            id="bom-component"
            options={options}
            value={componentId}
            onChange={setComponentId}
            placeholder={loading ? "Loading articles…" : "Search article number, EAN, GTIN…"}
            disabled={loading}
            emptyMessage="No matching non-composite articles"
            clearable
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="bom-add-quantity">
            Quantity
          </label>
          <input
            id="bom-add-quantity"
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
