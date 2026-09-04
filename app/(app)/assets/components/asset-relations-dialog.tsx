"use client";

import { useState } from "react";
import { Button, Dialog, Select, Stack, Text } from "@yourorg/ui";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { AssetDraft } from "./asset-draft";

export interface AssetRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Pick<AssetDraft, "clientId" | "siteId">;
  clients: ClientRecord[];
  /** Pre-scopes to a single client and hides the client picker — the Clients
   * detail page's Assets tab, or `?clientId=...` on `/assets/new`. */
  lockedClientId?: string;
  clientScoped: { sites: SiteRecord[]; loadingSites: boolean };
  /** Re-fetches `clientScoped` for the newly-previewed client — mirrors
   * `WorkOrderRelationsDialog`'s identical prop. */
  onClientChange: (clientId: string) => void;
  /** Commits Client + Site — `updateAsset` in edit mode (immediate), a local
   * draft merge in create mode (see `AssetScreen.commitPatch`). Only `siteId`
   * is ever actually sent to the server; Client is derived from the site's
   * own `client_id` at the DB layer (see `asset-draft.ts`'s `draftToInput`
   * doc comment). */
  onSave: (patch: Pick<AssetDraft, "clientId" | "siteId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The single small popup behind BOTH the Client and Site `RelationCard`s'
 * pencil buttons (asset new/edit design handoff v3) — same "one popup covers
 * every relation card that shares its own cascade" shape
 * `WorkOrderRelationCards`'s own doc comment documents for Work Orders' four-
 * card row, sized down to the two relations that are actually a Client ->
 * Site cascade (Model/Contract each get their own dedicated popup instead —
 * see `asset-model-dialog.tsx`/`asset-contracts-dialog.tsx`). Picking a
 * different client clears the site (both are scoped by client) — the same
 * small local reset rule `useRelationCascade`'s `handleClientChange` applies
 * for work orders, inlined here rather than reused: an asset has no
 * "asset"-level cascade tier under Client -> Site for that hook to also own.
 */
export function AssetRelationsDialog({
  open,
  onOpenChange,
  draft,
  clients,
  lockedClientId,
  clientScoped,
  onClientChange,
  onSave,
}: AssetRelationsDialogProps) {
  const [clientId, setClientId] = useState(draft.clientId);
  const [siteId, setSiteId] = useState(draft.siteId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setSiteId("");
    onClientChange(nextClientId);
  }

  async function handleSave() {
    if (!clientId) {
      setError("Select a client.");
      return;
    }
    if (!siteId) {
      setError("Select a site.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ clientId, siteId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
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
              <Select aria-label="Client" value={clientId} onChange={(event) => handleClientChange(event.target.value)}>
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
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              disabled={!clientId || clientScoped.loadingSites}
            >
              <option value="" disabled>
                {clientScoped.loadingSites ? "Loading sites…" : "Select a site…"}
              </option>
              {clientScoped.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {formatSiteAddressShort(site) ?? "Unnamed site"}
                </option>
              ))}
            </Select>
            {clientId && !clientScoped.loadingSites && clientScoped.sites.length === 0 && (
              <Text tone="muted">This client has no sites yet — add one from the Clients module first.</Text>
            )}
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
