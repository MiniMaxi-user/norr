"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Text, type ButtonSize } from "@yourorg/ui";
import { createContract } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { ContractClientDialog } from "./contract-client-dialog";

interface CreateContractButtonBaseProps {
  label?: string;
  /** The standalone Contracts module page's own toolbar button wants the
   * default (larger) size; the Clients detail page's Contracts tab
   * (`contracts-panel.tsx`) passes `"sm"` to match every other tab's
   * `SectionHeader` "+ X" button there — same `size` convention
   * `CreateAssetButton`/`CreateWorkOrderButton` already use. */
  size?: ButtonSize;
}

interface CreateContractButtonLockedProps extends CreateContractButtonBaseProps {
  /** Already known on the caller's page (e.g. the Clients detail page's
   * Contracts tab) — clicking creates the contract immediately, no dialog. */
  clientId: string;
  clients?: ClientRecord[];
}

interface CreateContractButtonPickerProps extends CreateContractButtonBaseProps {
  clientId?: undefined;
  /** Required when `clientId` isn't passed — `contracts.client_id` is a
   * required FK, so a client must be chosen before a contract can exist.
   * The standalone `/contracts` page's own `clients` list, fetched once in
   * `contracts-screen.tsx`. */
  clients: ClientRecord[];
}

export type CreateContractButtonProps = CreateContractButtonLockedProps | CreateContractButtonPickerProps;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Owner/finance "New contract" trigger — rendered only when
 * `can(actor, "contracts", "create")`, matching `createContract`'s own RBAC
 * gate. Creates the contract immediately (name "New contract", start date
 * today) and navigates straight to `/contracts/[id]`, where every field
 * (name, client, type, dates, notes, …) is edited inline exactly like any
 * other existing contract — there is no `/contracts/new` form page anymore.
 *
 * Two entry shapes:
 * - `clientId` passed (Clients detail page's Contracts tab): the client is
 *   already known, so the click creates + navigates with no dialog at all.
 * - `clientId` omitted (standalone Contracts module toolbar/empty state):
 *   `clients` must be passed instead, and the click opens a small
 *   `ContractClientDialog` client-picker; picking one creates + navigates.
 */
export function CreateContractButton({ clientId, clients, label, size }: CreateContractButtonProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function createAndNavigate(targetClientId: string): Promise<{ ok: boolean; error?: string }> {
    setError(null);
    setCreating(true);
    const result = await createContract({
      clientId: targetClientId,
      name: "New contract",
      startDate: todayIso(),
    });
    setCreating(false);
    if (!result.data) {
      const message = result.error ?? "Could not create this contract.";
      setError(message);
      return { ok: false, error: message };
    }
    router.push(`/contracts/${result.data.contract.id}`);
    return { ok: true };
  }

  function handleClick() {
    if (clientId) {
      void createAndNavigate(clientId);
      return;
    }
    setError(null);
    setPickerOpen(true);
  }

  return (
    <>
      <Button type="button" variant="primary" size={size} onClick={handleClick} disabled={creating}>
        {creating && !pickerOpen ? "Creating…" : (label ?? "New contract")}
      </Button>
      {error && !pickerOpen && <Text tone="danger">{error}</Text>}
      {pickerOpen && (
        <ContractClientDialog
          open
          onOpenChange={setPickerOpen}
          clientId=""
          clients={clients ?? []}
          onSave={createAndNavigate}
        />
      )}
    </>
  );
}
