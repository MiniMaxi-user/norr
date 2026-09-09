"use client";

import { Button, Dialog, Stack, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { useRelationDialogSave } from "@/lib/relation-cards/use-relation-dialog-save";
import type { WorkOrderDraft } from "./work-order-draft";
import { useRelationCascade } from "./use-relation-cascade";
import { WorkOrderRelationFields } from "./work-order-relation-fields";

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
 * when one is chosen). The cascade state/reset rules live in
 * `useRelationCascade` and the field markup in `WorkOrderRelationFields`
 * (both `./`, issue #106) — shared with `NewWorkOrderPickerDialog` rather
 * than reimplemented per popup; this component just supplies the Dialog
 * chrome and the "commit to an existing draft/work order" save behavior
 * (the validate/save/close sequence itself lives in the shared
 * `useRelationDialogSave`, issue #130 — see that hook's own doc comment).
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
  const { clientId, siteId, assetId, contractId, setAssetId, setContractId, handleClientChange, handleSiteChange } =
    useRelationCascade(draft, clientScoped.assets, onClientChange);
  const { saving, error, save } = useRelationDialogSave(onSave, onOpenChange);

  function handleSave() {
    void save({ clientId, siteId, assetId, contractId }, () => (!clientId ? "Select a client." : null));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Client, site, asset &amp; contract</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <WorkOrderRelationFields
            clientId={clientId}
            siteId={siteId}
            assetId={assetId}
            contractId={contractId}
            clients={clients}
            lockedClientId={lockedClientId}
            clientScoped={clientScoped}
            onClientChange={handleClientChange}
            onSiteChange={handleSiteChange}
            onAssetChange={setAssetId}
            onContractChange={setContractId}
          />
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
