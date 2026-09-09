"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { useRelationDialogSave } from "@/lib/relation-cards/use-relation-dialog-save";

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
 * immediately. The validate/save/close sequence comes from the shared
 * `useRelationDialogSave` (issue #130) — see that hook's own doc comment.
 */
export function ContractClientDialog({ open, onOpenChange, clientId, clients, onSave }: ContractClientDialogProps) {
  const [selected, setSelected] = useState(clientId);
  const { saving, error, save } = useRelationDialogSave(onSave, onOpenChange);

  function handleSave() {
    void save(selected, () => (!selected ? "Select a client." : null));
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
