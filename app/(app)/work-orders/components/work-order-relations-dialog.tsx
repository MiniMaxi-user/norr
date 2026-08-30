"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { WorkOrderDraft } from "./work-order-draft";

export interface WorkOrderRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: WorkOrderDraft;
  clients: ClientRecord[];
  /** Pre-scopes to a single client and hides the client picker — mirrors
   * `WorkOrderFields`'s old `lockedClientId` handling. */
  lockedClientId?: string;
  clientScoped: {
    sites: SiteRecord[];
    assets: AssetRecord[];
    contracts: ContractRecord[];
    loadingSites: boolean;
    loadingAssets: boolean;
    loadingContracts: boolean;
  };
  /** Re-fetches `clientScoped` for the newly-picked client — see
   * `WorkOrderScreen`'s own `handleClientChange`. */
  onClientChange: (clientId: string) => void;
  /** Commits the four relation fields — `updateWorkOrder` in edit mode,
   * local draft merge in create mode (see `WorkOrderScreen.commitPatch`). */
  onSave: (patch: Pick<WorkOrderDraft, "clientId" | "siteId" | "assetId" | "contractId">) => Promise<{
    ok: boolean;
    error?: string;
  }>;
}

/**
 * Small popup (`size="sm"`) behind every relation card's Edit button —
 * Client -> Site -> Asset + Contract, same cascade `WorkOrderFields` used to
 * own inline (client change resets site/asset/contract; site/asset stay
 * filtered to the selected client; asset re-filters to the selected site
 * when one is chosen) — ported here, not reimplemented.
 */
export function WorkOrderRelationsDialog({
  open,
  onOpenChange,
  draft,
  clients,
  lockedClientId,
  clientScoped,
  onClientChange,
  onSave,
}: WorkOrderRelationsDialogProps) {
  const [clientId, setClientId] = useState(draft.clientId);
  const [siteId, setSiteId] = useState(draft.siteId);
  const [assetId, setAssetId] = useState(draft.assetId);
  const [contractId, setContractId] = useState(draft.contractId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setSiteId("");
    setAssetId("");
    setContractId("");
    onClientChange(nextClientId);
  }

  function handleSiteChange(nextSiteId: string) {
    setSiteId(nextSiteId);
    const selectedAsset = clientScoped.assets.find((candidate) => candidate.id === assetId);
    if (nextSiteId && selectedAsset && selectedAsset.site_id !== nextSiteId) {
      setAssetId("");
    }
  }

  async function handleSave() {
    if (!clientId) {
      setError("Select a client.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ clientId, siteId, assetId, contractId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onOpenChange(false);
  }

  const filteredAssets = siteId
    ? clientScoped.assets.filter((candidate) => candidate.site_id === siteId)
    : clientScoped.assets;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Client, site, asset &amp; contract</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          {!lockedClientId && (
            <Stack gap="sm">
              <Label htmlFor="wo-rel-client">Client</Label>
              <Select
                id="wo-rel-client"
                value={clientId}
                onChange={(event) => handleClientChange(event.target.value)}
                required
              >
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
              onChange={(event) => handleSiteChange(event.target.value)}
              disabled={!clientId || clientScoped.loadingSites}
            >
              <option value="">{clientScoped.loadingSites ? "Loading sites…" : "No specific site"}</option>
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
              onChange={(event) => setAssetId(event.target.value)}
              disabled={!clientId || clientScoped.loadingAssets}
            >
              <option value="">
                {!clientId
                  ? "Select a client first…"
                  : clientScoped.loadingAssets
                    ? "Loading assets…"
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
              onChange={(event) => setContractId(event.target.value)}
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
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
