"use client";

import { useState } from "react";
import { Button, Dialog, Select, Stack, Text } from "@yourorg/ui";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";

export interface AssetRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  siteId: string;
  clients: ClientRecord[];
  /** Pre-scopes to a single client and hides the client picker — same
   * `lockedClientId` semantics `asset-form-dialog.tsx`/`WorkOrderRelationsDialog`
   * already use (the Clients detail page's Assets tab, and `?clientId=...`
   * on `/assets/new`). */
  lockedClientId?: string;
  sites: SiteRecord[];
  loadingSites: boolean;
  /** Re-fetches `sites` for the newly-picked client — owned by
   * `AssetFormScreen` (the same client-scoped-sites fetch effect
   * `asset-form-dialog.tsx`'s `AssetFormBody` already owns), mirroring
   * `WorkOrderRelationsDialog`'s `onClientChange`. */
  onClientChange: (clientId: string) => void;
  /** Commits Client + Site — a local draft merge, since neither field is
   * submitted until the page's own Save (Site is the only one actually sent
   * to the server; Client is derived from Site's own `client_id` at the DB
   * layer — see `asset-form-actions.ts`'s `formDataToAssetInput`, which never
   * reads a `clientId` field at all). */
  onSave: (patch: { clientId: string; siteId: string }) => void;
}

/**
 * The single small popup behind BOTH the Client and Site `RelationCard`s'
 * pencil buttons (asset new/edit design handoff, variant A: "No dropdown — a
 * pencil icon button... opens the existing entity picker") — same "one
 * popup covers every relation card on the page" shape
 * `WorkOrderRelationCards`'s own doc comment documents for Work Orders'
 * four-card row, just sized down to the two relations an asset actually has.
 * Picking a different client clears the site (both are scoped by client),
 * same reset rule `useRelationCascade`'s `handleClientChange` applies for
 * work orders.
 */
export function AssetRelationsDialog({
  open,
  onOpenChange,
  clientId,
  siteId,
  clients,
  lockedClientId,
  sites,
  loadingSites,
  onClientChange,
  onSave,
}: AssetRelationsDialogProps) {
  const [localClientId, setLocalClientId] = useState(clientId);
  const [localSiteId, setLocalSiteId] = useState(siteId);
  const [error, setError] = useState<string | null>(null);

  function handleClientChange(nextClientId: string) {
    setLocalClientId(nextClientId);
    setLocalSiteId("");
    onClientChange(nextClientId);
  }

  function handleSave() {
    if (!localClientId) {
      setError("Select a client.");
      return;
    }
    if (!localSiteId) {
      setError("Select a site.");
      return;
    }
    setError(null);
    onSave({ clientId: localClientId, siteId: localSiteId });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Client &amp; site</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          {!lockedClientId && (
            <Stack gap="xs">
              <Text tone="muted">Client</Text>
              <Select
                aria-label="Client"
                value={localClientId}
                onChange={(event) => handleClientChange(event.target.value)}
              >
                <option value="" disabled>
                  Select a client…
                </option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Stack>
          )}

          <Stack gap="xs">
            <Text tone="muted">Site</Text>
            <Select
              aria-label="Site"
              value={localSiteId}
              onChange={(event) => setLocalSiteId(event.target.value)}
              disabled={!localClientId || loadingSites}
            >
              <option value="" disabled>
                {loadingSites ? "Loading sites…" : "Select a site…"}
              </option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {formatSiteAddressShort(site) ?? "Unnamed site"}
                </option>
              ))}
            </Select>
            {localClientId && !loadingSites && sites.length === 0 && (
              <Text tone="muted">This client has no sites yet — add one from the Clients module first.</Text>
            )}
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave}>
          Save
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
