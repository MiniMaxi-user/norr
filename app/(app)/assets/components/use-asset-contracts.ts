"use client";

import { useCallback, useEffect, useState } from "react";
import { listAssetContractCoverage, type AssetContractCoverage } from "@/app/(app)/contracts/actions";

/**
 * Fetches every contract that covers a single asset — both directly linked
 * (`contract_assets`) AND inherited from an ancestor composite asset via the
 * `asset_components` chain (issue #126) — backing the Contract relation
 * card's display (first covering contract, "+N more") and its edit popup's
 * own list. `enabled: false` (create mode, where there is no `assetId` yet,
 * or a `readOnly` viewer whose relation card already has everything it
 * needs) skips the fetch entirely, same "don't fetch what can't render"
 * convention `useClientScopedLists` documents for itself. `refresh()` is
 * exposed so the edit popup can re-fetch right after a link/unlink for
 * instant feedback, without waiting on the page's own `router.refresh()`
 * (which the popup also triggers, to keep the hero's "Work orders" KPI
 * tile's "N contract" figure in sync too).
 */
export function useAssetContracts(assetId: string | undefined, enabled: boolean) {
  const [coverage, setCoverage] = useState<AssetContractCoverage[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!enabled || !assetId) {
      setCoverage([]);
      return;
    }
    setLoading(true);
    listAssetContractCoverage(assetId)
      .then((result) => setCoverage(result.data?.coverage ?? []))
      .finally(() => setLoading(false));
  }, [enabled, assetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { coverage, loading, refresh };
}
