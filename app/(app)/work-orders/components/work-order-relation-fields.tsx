"use client";

import { Label, Select, Stack } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { ContractRecord } from "@/app/(app)/contracts/actions";

export interface RelationFieldsScoped {
  sites: SiteRecord[];
  assets: AssetRecord[];
  contracts: ContractRecord[];
  loadingSites: boolean;
  loadingAssets: boolean;
  loadingContracts: boolean;
}

export interface WorkOrderRelationFieldsProps {
  clientId: string;
  siteId: string;
  assetId: string;
  contractId: string;
  clients: ClientRecord[];
  /** Pre-scopes to a single client and hides the client picker — mirrors
   * `WorkOrderFields`'s old `lockedClientId` handling. */
  lockedClientId?: string;
  clientScoped: RelationFieldsScoped;
  onClientChange: (clientId: string) => void;
  onSiteChange: (siteId: string) => void;
  onAssetChange: (assetId: string) => void;
  onContractChange: (contractId: string) => void;
  /** Marks Site/Asset as required `<Select>`s — the hero's own edit-
   * relations popup (`WorkOrderRelationsDialog`) allows a work order with no
   * specific site/asset, but issue #106's Overview "New work order" picker
   * (`NewWorkOrderPickerDialog`) requires all three (Client/Site/Asset)
   * before it will hand off to the real create screen. Contract is always
   * optional in both. */
  requireSiteAndAsset?: boolean;
}

/**
 * Client -> Site -> Asset + Contract cascade picker fields (issue #102,
 * factored out for issue #106) — the Select markup shared by
 * `WorkOrderRelationsDialog` (re-picks an existing draft/work order's
 * relations) and `NewWorkOrderPickerDialog` (collects a fresh selection with
 * no existing record yet, from the Overview page's "New work order" button).
 * Purely presentational: state/reset rules live in `useRelationCascade`
 * (`./use-relation-cascade.ts`), owned by each caller so they can commit the
 * result differently (an immediate `updateWorkOrder`/local draft merge here
 * vs. a `router.push` to `/work-orders/new?...` there).
 */
export function WorkOrderRelationFields({
  clientId,
  siteId,
  assetId,
  contractId,
  clients,
  lockedClientId,
  clientScoped,
  onClientChange,
  onSiteChange,
  onAssetChange,
  onContractChange,
  requireSiteAndAsset,
}: WorkOrderRelationFieldsProps) {
  const filteredAssets = siteId
    ? clientScoped.assets.filter((candidate) => candidate.site_id === siteId)
    : clientScoped.assets;

  return (
    <Stack gap="md">
      {!lockedClientId && (
        <Stack gap="sm">
          <Label htmlFor="wo-rel-client">Client</Label>
          <Select id="wo-rel-client" value={clientId} onChange={(event) => onClientChange(event.target.value)} required>
            <option value="" disabled>
              Select a client…
            </option>
            {clients.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Stack>
      )}

      <Stack gap="sm">
        <Label htmlFor="wo-rel-site">Site</Label>
        <Select
          id="wo-rel-site"
          value={siteId}
          onChange={(event) => onSiteChange(event.target.value)}
          disabled={!clientId || clientScoped.loadingSites}
          required={requireSiteAndAsset}
        >
          <option value="" disabled={requireSiteAndAsset}>
            {clientScoped.loadingSites
              ? "Loading sites…"
              : requireSiteAndAsset
                ? "Select a site…"
                : "No specific site"}
          </option>
          {clientScoped.sites.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {formatSiteAddressShort(candidate) ?? "Unnamed site"}
            </option>
          ))}
        </Select>
      </Stack>

      <Stack gap="sm">
        <Label htmlFor="wo-rel-asset">Asset</Label>
        <Select
          id="wo-rel-asset"
          value={assetId}
          onChange={(event) => onAssetChange(event.target.value)}
          disabled={!clientId || clientScoped.loadingAssets}
          required={requireSiteAndAsset}
        >
          <option value="" disabled={requireSiteAndAsset}>
            {!clientId
              ? "Select a client first…"
              : clientScoped.loadingAssets
                ? "Loading assets…"
                : requireSiteAndAsset
                  ? "Select an asset…"
                  : "No specific asset"}
          </option>
          {filteredAssets.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </Stack>

      <Stack gap="sm">
        <Label htmlFor="wo-rel-contract">Contract</Label>
        <Select
          id="wo-rel-contract"
          value={contractId}
          onChange={(event) => onContractChange(event.target.value)}
          disabled={!clientId || clientScoped.loadingContracts}
        >
          <option value="">
            {!clientId
              ? "Select a client first…"
              : clientScoped.loadingContracts
                ? "Loading contracts…"
                : "No contract"}
          </option>
          {clientScoped.contracts.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </Stack>
    </Stack>
  );
}
