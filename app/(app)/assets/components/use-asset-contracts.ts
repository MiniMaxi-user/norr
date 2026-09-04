"use client";

import { useCallback, useEffect, useState } from "react";
import { listContractsForAsset, type ContractRecord } from "@/app/(app)/contracts/actions";

/**
 * Fetches the contracts linked to a single asset (via `contract_assets`) —
 * backs the Contract relation card's display (first linked contract, "+N
 * more") and its edit popup's own list. `enabled: false` (create mode, where
 * there is no `assetId` yet, or a `readOnly` viewer whose relation card
 * already has everything it needs) skips the fetch entirely, same
 * "don't fetch what can't render" convention `useClientScopedLists` documents
 * for itself. `refresh()` is exposed so the edit popup can re-fetch right
 * after a link/unlink for instant feedback, without waiting on the page's own
 * `router.refresh()` (which the popup also triggers, to keep the hero's
 * "Work orders" KPI tile's "N contract" figure in sync too).
 */
export function useAssetContracts(assetId: string | undefined, enabled: boolean) {
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!enabled || !assetId) {
      setContracts([]);
      return;
    }
    setLoading(true);
    listContractsForAsset(assetId)
      .then((result) => setContracts(result.data?.contracts ?? []))
      .finally(() => setLoading(false));
  }, [enabled, assetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { contracts, loading, refresh };
}
