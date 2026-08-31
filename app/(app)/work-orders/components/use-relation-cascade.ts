"use client";

import { useState } from "react";
import type { AssetRecord } from "@/app/(app)/assets/actions";

export interface RelationCascadeInitial {
  clientId: string;
  siteId: string;
  assetId: string;
  contractId: string;
}

/**
 * Client -> Site -> Asset + Contract cascade state/reset rules (issue #106),
 * factored out of `WorkOrderRelationsDialog` so it can be shared with
 * `NewWorkOrderPickerDialog` (the Overview page's "New work order" popup)
 * instead of re-deriving the same reset behavior twice:
 *  - picking a different client clears site/asset/contract (all three are
 *    scoped by client);
 *  - picking a site that doesn't match the currently-selected asset's own
 *    `site_id` clears the asset too.
 * These are the exact rules `WorkOrderFields` (the pre-issue-#102 form)
 * originally owned inline, ported forward rather than reimplemented.
 *
 * `assets` is passed in (not fetched here) — both callers already own a
 * `useClientScopedLists` result and would otherwise have to thread it back
 * out just for this hook to read it.
 */
export function useRelationCascade(
  initial: RelationCascadeInitial,
  assets: AssetRecord[],
  onClientChange: (clientId: string) => void,
) {
  const [clientId, setClientId] = useState(initial.clientId);
  const [siteId, setSiteId] = useState(initial.siteId);
  const [assetId, setAssetId] = useState(initial.assetId);
  const [contractId, setContractId] = useState(initial.contractId);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setSiteId("");
    setAssetId("");
    setContractId("");
    onClientChange(nextClientId);
  }

  function handleSiteChange(nextSiteId: string) {
    setSiteId(nextSiteId);
    const selectedAsset = assets.find((candidate) => candidate.id === assetId);
    if (nextSiteId && selectedAsset && selectedAsset.site_id !== nextSiteId) {
      setAssetId("");
    }
  }

  return {
    clientId,
    siteId,
    assetId,
    contractId,
    setAssetId,
    setContractId,
    handleClientChange,
    handleSiteChange,
  };
}
