"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";

export interface ContractClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clients: ClientRecord[];
  onSave: (clientId: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small client-picker popup — a `Select` of clients plus Cancel/Save,
 * nothing else, mirroring `WorkOrderRelationsDialog`'s own "RelationCard
 * pencil -> Dialog" shape (`app/(app)/work-orders/components/
 * work-order-relations-dialog.tsx`). Used two places: the Client
 * `RelationCard`'s edit pencil on `/contracts/[id]` (`contract-screen.tsx`,
 * pre-filled with the contract's current client), and `CreateContractButton`
 * (`create-contract-button.tsx`) when it's rendered with no `clientId` lock
 * — there `clientId` starts empty and picking one creates the contract
 * immediately.
 */
export function ContractClientDialog({ open, onOpenChange, clientId, clients, onSave }: ContractClientDialogProps) {
  const [selected, setSelected] = useState(clientId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!selected) {
      setError("Select a client.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave(selected);
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
        <Text>{clientId ? "Change client" : "Select a client"}</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-client-select">Client</Label>
            <Select
              id="contract-client-select"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
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
