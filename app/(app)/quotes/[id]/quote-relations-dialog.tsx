"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { useRelationDialogSave } from "@/lib/relation-cards/use-relation-dialog-save";

export interface QuoteRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clients: ClientRecord[];
  onSave: (patch: { clientId: string }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small popup (`size="sm"`) behind the Client `RelationCard`'s Edit button —
 * a smaller cousin of `app/(app)/work-orders/components/
 * work-order-relations-dialog.tsx`. A quote is linked to a client only (no
 * site/asset/contract cascade). The validate/save/close sequence comes from
 * the shared `useRelationDialogSave` (issue #130) — see that hook's own doc
 * comment.
 */
export function QuoteRelationsDialog({ open, onOpenChange, clientId, clients, onSave }: QuoteRelationsDialogProps) {
  const [selectedClientId, setSelectedClientId] = useState(clientId);
  const { saving, error, save } = useRelationDialogSave(onSave, onOpenChange);

  function handleSave() {
    void save({ clientId: selectedClientId }, () => (!selectedClientId ? "Select a client." : null));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Client</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          <Stack gap="sm">
            <Label htmlFor="quote-relations-client">Client</Label>
            <Select
              id="quote-relations-client"
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
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
