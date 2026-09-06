"use client";

import { useCallback, useEffect, useState } from "react";
import { getAssetCompositionTree, type AssetComponentTreeNode } from "../components-actions";

/**
 * Fetches an asset's WHOLE composition tree (always rooted at the true top
 * of its assembly chain, never just this asset's own immediate slice — see
 * `getAssetCompositionTree`'s own doc comment) — backs
 * `AssetCompositeSection`'s tree view. `enabled: false` (create mode, where
 * there's no `assetId` yet) skips the fetch entirely, same "don't fetch what
 * can't render" convention `useAssetContracts`/`useClientScopedLists`
 * document for themselves. `refresh()` is exposed so
 * `AssetCompositeManageDialog` can trigger an immediate re-fetch right after
 * an add/remove/quantity change, without requiring a manual page reload.
 */
export function useAssetCompositionTree(assetId: string | undefined, enabled: boolean) {
  const [tree, setTree] = useState<AssetComponentTreeNode | null>(null);
  const [currentAssetId, setCurrentAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!enabled || !assetId) {
      setTree(null);
      setCurrentAssetId(null);
      return;
    }
    setLoading(true);
    setError(null);
    getAssetCompositionTree(assetId)
      .then((result) => {
        if (!result.data) {
          setError(result.error ?? "Could not load this asset's composition.");
          setTree(null);
          setCurrentAssetId(null);
          return;
        }
        setTree(result.data.tree);
        setCurrentAssetId(result.data.currentAssetId);
      })
      .finally(() => setLoading(false));
  }, [enabled, assetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tree, currentAssetId, loading, error, refresh };
}
