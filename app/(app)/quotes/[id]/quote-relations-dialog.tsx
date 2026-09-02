"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";

export interface QuoteRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  siteId: string | null;
  clients: ClientRecord[];
  onSave: (patch: { clientId: string; siteId: string | null }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small popup (`size="sm"`) behind the Client/Site `RelationCard`s' shared
 * Edit button — a smaller cousin of `app/(app)/work-orders/components/
 * work-order-relations-dialog.tsx`: same Client -> Site cascade (client
 * change resets and re-fetches the site list, same `listSites(clientId)`
 * pattern `quote-form.tsx` already uses for the create/edit form), just
 * without the Asset/Contract cascade parts a quote has no equivalent of.
 */
export function QuoteRelationsDialog({ open, onOpenChange, clientId, siteId, clients, onSave }: QuoteRelationsDialogProps) {
  const [selectedClientId, setSelectedClientId] = useState(clientId);
  const [selectedSiteId, setSelectedSiteId] = useState(siteId ?? "");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(selectedClientId)
      .then((result) => {
        if (cancelled) return;
        setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  function handleClientChange(nextClientId: string) {
    setSelectedClientId(nextClientId);
    // A new client invalidates any previously selected site — same
    // "discard the now-stale child selection" reasoning `quote-form.tsx`'s
    // own `handleClientChange` documents.
    setSelectedSiteId("");
  }

  async function handleSave() {
    if (!selectedClientId) {
      setError("Select a client.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ clientId: selectedClientId, siteId: selectedSiteId || null });
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

          <Stack gap="sm">
            <Label htmlFor="quote-relations-client">Client</Label>
            <Select
              id="quote-relations-client"
              value={selectedClientId}
              onChange={(event) => handleClientChange(event.target.value)}
              required
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

          <Stack gap="sm">
            <Label htmlFor="quote-relations-site">Site</Label>
            <Select
              id="quote-relations-site"
              value={selectedSiteId}
              onChange={(event) => setSelectedSiteId(event.target.value)}
              disabled={!selectedClientId || loadingSites}
            >
              <option value="">
                {!selectedClientId ? "Select a client first…" : loadingSites ? "Loading sites…" : "No specific site"}
              </option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {formatSiteAddressShort(site) ?? "Unnamed site"}
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
