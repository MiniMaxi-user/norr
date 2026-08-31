"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { useClientScopedLists } from "./use-client-scoped-lists";
import { useRelationCascade } from "./use-relation-cascade";
import { WorkOrderRelationFields } from "./work-order-relation-fields";

export interface NewWorkOrderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientRecord[];
  /** Pre-scopes (and hides the picker for) a single client — mirrors
   * `WorkOrderRelationsDialog`'s own `lockedClientId`, for a future client-
   * scoped "New work order" entry point (`CreateWorkOrderButton`'s existing
   * `clientId` prop). */
  lockedClientId?: string;
}

/**
 * Issue #106 — the Overview page's "New work order" button used to link
 * straight to `/work-orders/new`. It now opens this small popup FIRST to
 * collect Client (required), Site (required) and Asset (required) — Contract
 * stays optional, same cascade rules `WorkOrderRelationsDialog` already
 * uses, reused here via `useRelationCascade`/`WorkOrderRelationFields`
 * rather than reimplemented. On confirm, this dialog does not persist
 * anything itself — it only builds `/work-orders/new?clientId=&siteId=&
 * assetId=&contractId=` and navigates there, dropping the user into the
 * real (already-existing) full create screen for the actual Save. Opening/
 * editing an EXISTING work order is unaffected — it still goes straight to
 * `/work-orders/[id]` (see `work-orders-table.tsx`), this popup only sits in
 * front of the brand-new-record entry point.
 *
 * `scopingClientId` mirrors `WorkOrderScreen`'s own identically-named piece
 * of state: `useRelationCascade` owns `clientId` as its OWN internal state
 * (so `WorkOrderRelationsDialog` can keep using it unchanged), but
 * `useClientScopedLists` needs a client id to re-fetch Sites/Assets/
 * Contracts for BEFORE that state's own next render — so `handleClientChange`
 * is handed `setScopingClientId` as its `onClientChange` callback, same
 * "cascade hook decides `clientId`, a sibling `useState` just mirrors it for
 * the fetch" wiring `WorkOrderScreen` already established.
 */
export function NewWorkOrderPickerDialog({ open, onOpenChange, clients, lockedClientId }: NewWorkOrderPickerDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const initial = { clientId: lockedClientId ?? "", siteId: "", assetId: "", contractId: "" };
  const [scopingClientId, setScopingClientId] = useState(initial.clientId);
  const clientScoped = useClientScopedLists(scopingClientId, open);
  const { clientId, siteId, assetId, contractId, setAssetId, setContractId, handleClientChange, handleSiteChange } =
    useRelationCascade(initial, clientScoped.assets, setScopingClientId);

  function handleContinue() {
    if (!clientId || !siteId || !assetId) {
      setError("Select a client, site, and asset to continue.");
      return;
    }
    setError(null);
    const params = new URLSearchParams({ clientId, siteId, assetId });
    if (contractId) params.set("contractId", contractId);
    onOpenChange(false);
    router.push(`/work-orders/new?${params.toString()}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>New work order</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          <Text tone="muted">Pick the client, site &amp; asset this work order is for — contract is optional.</Text>
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
            requireSiteAndAsset
          />
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleContinue}>
          Continue
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
