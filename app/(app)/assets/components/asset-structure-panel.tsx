"use client";

import { useMemo, useState } from "react";
import { toast } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import {
  StructureTree,
  WebConfirmDialog,
  toneFromColor,
  type StructureTreeNode,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import { formatNumberWeb } from "@/lib/format/web";
import { removeAssetComponent, updateAssetComponent, type AssetComponentTreeNode } from "../components-actions";

/** Does this asset sit in a composite structure (it has a parent or children)?
 * Every asset gets a tree back — a lone asset is a single-node tree. */
export function hasStructure(tree: AssetComponentTreeNode | null): boolean {
  if (!tree) return false;
  return !(tree.isCurrent && tree.children.length === 0);
}

function countAll(node: AssetComponentTreeNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countAll(child), 0);
}

/** Number of assets in the structure (0 when the asset is not part of one) —
 * the Structure tab's counter. */
export function structureSize(tree: AssetComponentTreeNode | null): number {
  return tree && hasStructure(tree) ? countAll(tree) : 0;
}

export interface StructureInfo {
  /** Root → direct parent of the current asset (empty when it is the root). */
  ancestors: { id: string; name: string }[];
  /** Everything below the current asset (all levels). */
  componentCount: number;
}

/** Path upward and component count of the current asset, for the rail. */
export function structureInfo(tree: AssetComponentTreeNode | null): StructureInfo | null {
  if (!tree || !hasStructure(tree)) return null;
  let ancestors: { id: string; name: string }[] = [];
  let componentCount = 0;
  (function walk(node: AssetComponentTreeNode, path: { id: string; name: string }[]) {
    if (node.isCurrent) {
      ancestors = path;
      componentCount = countAll(node) - 1;
      return;
    }
    for (const child of node.children) walk(child, [...path, { id: node.asset.id, name: node.asset.name }]);
  })(tree, []);
  return { ancestors, componentCount };
}

export interface AssetStructurePanelProps {
  tree: AssetComponentTreeNode | null;
  canManage: boolean;
  /** Opens the link dialog scoped to this parent. */
  onLink: (parent: { id: string; name: string }) => void;
  /** After unlink / quantity change: refresh the page data. */
  onChange: () => void;
}

/**
 * "Structure" tab (composite assets, issue #125; StructureTree, issue #222).
 * The whole composition the asset is part of, always from the root, with the
 * current asset highlighted. Linking, unlinking and the quantity are managed
 * here (toolbar + ··· per row), not through the page's Edit button. "Move
 * to…" is not offered: the backend only supports unlink + link (two separate,
 * non-atomic writes), so a move stays those two explicit steps.
 */
export function AssetStructurePanel({ tree, canManage, onLink, onChange }: AssetStructurePanelProps) {
  const [unlinking, setUnlinking] = useState<{ rowId: string; name: string } | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [unlinkPending, setUnlinkPending] = useState(false);
  const [quantityTarget, setQuantityTarget] = useState<{ rowId: string; name: string } | null>(null);
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [quantityPending, setQuantityPending] = useState(false);

  const nodes = useMemo<StructureTreeNode[]>(() => {
    if (!tree || !hasStructure(tree)) return [];
    function convert(node: AssetComponentTreeNode): StructureTreeNode {
      const asset = node.asset;
      const actions: WebMenuItem[] = [];
      if (!node.isCurrent) actions.push({ key: "open", label: "Open asset", href: `/assets/${asset.id}` });
      if (canManage) {
        actions.push({ key: "link", label: "Link component…", onSelect: () => onLink({ id: asset.id, name: asset.name }) });
        if (node.componentRowId) {
          const rowId = node.componentRowId;
          actions.push({
            key: "quantity",
            label: "Change quantity…",
            onSelect: () => {
              setQuantityError(null);
              setQuantityValue(String(node.quantity ?? 1));
              setQuantityTarget({ rowId, name: asset.name });
            },
          });
          actions.push({ type: "separator", key: "sep" });
          actions.push({
            key: "unlink",
            label: "Unlink",
            danger: true,
            onSelect: () => {
              setUnlinkError(null);
              setUnlinking({ rowId, name: asset.name });
            },
          });
        }
      }
      return {
        id: asset.id,
        label: asset.name,
        secondary: asset.serial_number,
        href: `/assets/${asset.id}`,
        status: asset.asset_status
          ? { label: asset.asset_status.label, tone: toneFromColor(asset.asset_status.color) }
          : null,
        quantity: node.quantity === null ? null : formatNumberWeb(node.quantity),
        isCurrent: node.isCurrent,
        actions,
        children: node.children.map(convert),
      };
    }
    return [convert(tree)];
  }, [tree, canManage, onLink]);

  async function confirmUnlink() {
    if (!unlinking) return;
    setUnlinkPending(true);
    setUnlinkError(null);
    const result = await removeAssetComponent(unlinking.rowId);
    setUnlinkPending(false);
    if (result.error || !result.data) {
      setUnlinkError(result.error ?? "Could not unlink this component. Try again.");
      return;
    }
    toast({ title: "Component unlinked", duration: 3000 });
    setUnlinking(null);
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
    const result = await updateAssetComponent(quantityTarget.rowId, { quantity: parsed });
    setQuantityPending(false);
    if (!result.data) {
      setQuantityError(result.error ?? "Could not change the quantity. Try again.");
      return;
    }
    toast({ title: "Quantity changed", duration: 3000 });
    setQuantityTarget(null);
    onChange();
  }

  // The toolbar's "+ Link component" links under the current asset.
  const linkTarget = useMemo(() => {
    let found: { id: string; name: string } | null = null;
    (function walk(node: AssetComponentTreeNode | null) {
      if (!node) return;
      if (node.isCurrent) found = { id: node.asset.id, name: node.asset.name };
      node.children.forEach(walk);
    })(tree);
    return found as { id: string; name: string } | null;
  }, [tree]);

  return (
    <>
      <StructureTree
        title="Structure"
        nodes={nodes}
        noun="assets"
        currentLabel="this asset"
        childNoun="components"
        statusHeader="Status"
        showQuantity
        quantityHeader="Qty"
        ariaLabel="Asset structure"
        add={
          canManage && linkTarget ? (
            <WebButton size="filter" onClick={() => onLink(linkTarget)}>
              + Link component
            </WebButton>
          ) : undefined
        }
        emptyText="This asset has no components."
        emptyAction={
          canManage && linkTarget ? (
            <button type="button" className="web-rail-link" onClick={() => onLink(linkTarget)}>
              Link component
            </button>
          ) : undefined
        }
      />

      <WebConfirmDialog
        open={Boolean(unlinking)}
        title="Unlink component?"
        confirmLabel="Unlink"
        confirmVariant="danger"
        pending={unlinkPending}
        error={unlinkError}
        onCancel={() => setUnlinking(null)}
        onConfirm={() => void confirmUnlink()}
      >
        {unlinking?.name} is removed from this structure. The asset itself is kept.
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
        <label className="web-field-label" htmlFor="structure-quantity">
          Quantity of {quantityTarget?.name}
        </label>
        <input
          id="structure-quantity"
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
