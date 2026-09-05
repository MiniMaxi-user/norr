"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Stack, Text } from "@yourorg/ui";
import { CreditCard } from "@yourorg/ui/icons";
import type { ClientDraft } from "./client-draft";

export interface ClientBusinessDetailsSectionProps {
  mode: "create" | "edit";
  draft: Pick<ClientDraft, "name" | "kvkNumber" | "vatNumber" | "iban">;
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ClientDraft, "name" | "kvkNumber" | "vatNumber" | "iban">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Business details" section (Client Details tab redo) — Name/KvK number/
 * VAT number/IBAN, the same field set `edit-client-panel.tsx`'s old "Business
 * details" `FormSection` had (plus Name, previously its own separate "Client"
 * section — folded in here since the screenshot groups Name with the rest of
 * the business fields). Same read-card/accent-edit-card toggle as
 * `AssetEquipmentSection`/`AssetStatusWarrantySection` — see either of those
 * for the create/edit mode behavior split this mirrors exactly.
 */
export function ClientBusinessDetailsSection({
  mode,
  draft,
  editing,
  onEditToggle,
  readOnly,
  onSave,
}: ClientBusinessDetailsSectionProps) {
  const [name, setName] = useState(draft.name);
  const [kvkNumber, setKvkNumber] = useState(draft.kvkNumber);
  const [vatNumber, setVatNumber] = useState(draft.vatNumber);
  const [iban, setIban] = useState(draft.iban);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setName(draft.name);
    setKvkNumber(draft.kvkNumber);
    setVatNumber(draft.vatNumber);
    setIban(draft.iban);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setName(draft.name);
    setKvkNumber(draft.kvkNumber);
    setVatNumber(draft.vatNumber);
    setIban(draft.iban);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ name, kvkNumber, vatNumber, iban });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={CreditCard}
      title="Business details"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit business details"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="client-business-name">Name</Label>
            <Input id="client-business-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Stack>
          <FormGrid columns={3}>
            <Stack gap="xs">
              <Label htmlFor="client-business-kvk">KvK number</Label>
              <Input
                id="client-business-kvk"
                value={kvkNumber}
                onChange={(event) => setKvkNumber(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="client-business-vat">VAT number</Label>
              <Input
                id="client-business-vat"
                value={vatNumber}
                onChange={(event) => setVatNumber(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="client-business-iban">IBAN</Label>
              <Input id="client-business-iban" value={iban} onChange={(event) => setIban(event.target.value)} />
            </Stack>
          </FormGrid>
          <Inline gap="sm" justify="end">
            {mode === "edit" && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Inline>
        </Stack>
      }
    >
      <KeyValueList
        items={[
          { key: "name", label: "Name", value: <Text>{draft.name || "—"}</Text> },
          { key: "kvk", label: "KvK number", value: <Text>{draft.kvkNumber || "—"}</Text> },
          { key: "vat", label: "VAT number", value: <Text>{draft.vatNumber || "—"}</Text> },
          { key: "iban", label: "IBAN", value: <Text>{draft.iban || "—"}</Text> },
        ]}
      />
    </EditableSection>
  );
}
