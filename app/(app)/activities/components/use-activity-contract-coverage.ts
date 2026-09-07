"use client";

import { useEffect, useState } from "react";
import { listAssetContractCoverage, type AssetContractCoverage } from "@/app/(app)/contracts/actions";

/**
 * Fetches the Contract relation card's data for the activity's linked ASSET
 * (issue #128 — same-day reversal/redo of #127's stored `contract_id`
 * picker). Per the product-owner reasoning on #128: an activity has no
 * contract relation of its own — if you know the asset, you already know
 * which contract(s) cover it, so the card is DERIVED, not stored/edited.
 *
 * Mirrors `useAssetContracts` (`app/(app)/assets/components/use-asset-contracts.ts`)
 * almost exactly — same `listAssetContractCoverage(assetId)` call, direct AND
 * inherited (issue #126's `asset_components` walk-up), same `{ coverage,
 * loading }` shape. Kept as its own hook (rather than folded into
 * `useClientScopedActivityLists`) since it's keyed on `assetId`, not
 * `clientId`, and only ever needed by `ActivityHero`'s Contract card — the
 * client-fallback case (no asset, just a client) reads
 * `clientScoped.contracts` directly instead, no coverage walk needed there.
 *
 * Passive display info, like `sites` in `useClientScopedActivityLists` — kept
 * fetching regardless of `readOnly`, since a read-only viewer still needs to
 * see the card.
 */
export function useActivityContractCoverage(assetId: string | undefined) {
  const [coverage, setCoverage] = useState<AssetContractCoverage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId) {
      setCoverage([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listAssetContractCoverage(assetId)
      .then((result) => {
        if (!cancelled) setCoverage(result.data?.coverage ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return { coverage, loading };
}
