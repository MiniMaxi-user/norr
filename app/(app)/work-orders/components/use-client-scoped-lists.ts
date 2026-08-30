"use client";

import { useEffect, useState } from "react";
import { listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { listSites, type SiteRecord } from "@/app/(app)/clients/actions";
import { listContracts, type ContractRecord } from "@/app/(app)/contracts/actions";

/** High enough for "every asset/contract across this client's sites" in one
 * request — a work order's own pickers are a bounded, per-record scope, not
 * the org-wide Assets/Contracts list (which paginates). Matches the client
 * detail page's `ALL_CLIENT_ASSETS_LIMIT` convention. */
const ALL_CLIENT_SCOPED_LIMIT = 500;

/**
 * Fetches the Sites/Assets/Contracts belonging to a single client — shared
 * by `WorkOrderRelationCards` (to resolve the Site/Asset/Contract relation
 * cards' display facts as soon as a different client is picked, before any
 * save) and `WorkOrderRelationsDialog` (as the picker `<option>` lists).
 * Kept as ONE hook call at the `WorkOrderScreen` level rather than one per
 * consumer, so both always see the exact same fetched lists (no risk of the
 * cards and the dialog racing to different results). `enabled: false`
 * (a `readOnly` viewer, who can never open the dialog and whose relation
 * cards already have everything they need from the resolved `client`/
 * `site`/`asset`/`contract` props) skips every fetch entirely — same
 * "don't fetch what can't render" convention `[id]/page.tsx` already
 * documents for its own server-side fetches.
 */
export function useClientScopedLists(clientId: string, enabled: boolean) {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingContracts, setLoadingContracts] = useState(false);

  useEffect(() => {
    if (!enabled || !clientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(clientId)
      .then((result) => {
        if (!cancelled) setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  useEffect(() => {
    if (!enabled || !clientId) {
      setAssets([]);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    listAssets({ clientId, limit: ALL_CLIENT_SCOPED_LIMIT })
      .then((result) => {
        if (!cancelled) setAssets(result.data?.assets ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  useEffect(() => {
    if (!enabled || !clientId) {
      setContracts([]);
      return;
    }
    let cancelled = false;
    setLoadingContracts(true);
    listContracts({ clientId, limit: ALL_CLIENT_SCOPED_LIMIT })
      .then((result) => {
        if (!cancelled) setContracts(result.data?.contracts ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingContracts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  return { sites, assets, contracts, loadingSites, loadingAssets, loadingContracts };
}
