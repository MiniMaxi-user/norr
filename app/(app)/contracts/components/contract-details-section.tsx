"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, EditableSection, Inline, Input, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ContractRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ContractDraft } from "./contract-draft";

export interface ContractDetailsSectionProps {
  mode: "create" | "edit";
  draft: Pick<ContractDraft, "clientId" | "name" | "typeId">;
  /** Edit mode only — the read view's Client link/Type badge source their
   * label/color straight from this already-resolved record, same
   * "read view sources from the server record" split every other section
   * on this screen uses. */
  contract?: ContractRecord;
  /** The resolved client, for the read view's link — `null` while unknown
   * (shouldn't normally happen; `client_id` is required). */
  client?: ClientRecord | null;
  /** Org's clients, for the picker. Ignored (and the picker hidden entirely,
   * showing a locked display instead) when `lockedClientId` is set. */
  clients: ClientRecord[];
  lockedClientId?: string;
  contractTypes: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (patch: Pick<ContractDraft, "clientId" | "name" | "typeId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Contract details" section (issue #122) — who this agreement is with, its
 * own name, and its Type. Same read-card/accent-edit-card toggle every other
 * section on this screen uses; in `mode: "create"` this always renders the
 * edit card (no pencil, nothing to toggle back to yet — `ContractScreen`
 * keeps `editing` fixed `true` for the whole create flow).
 */
export function ContractDetailsSection({
  mode,
  draft,
  contract,
  client,
  clients,
  lockedClientId,
  contractTypes,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: ContractDetailsSectionProps) {
  const [clientId, setClientId] = useState(draft.clientId);
  const [name, setName] = useState(draft.name);
  const [typeId, setTypeId] = useState(draft.typeId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setClientId(draft.clientId);
    setName(draft.name);
    setTypeId(draft.typeId);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const defaultType = contractTypes.find((item) => item.is_default);

  function handleCancel() {
    setClientId(draft.clientId);
    setName(draft.name);
    setTypeId(draft.typeId);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    if (!lockedClientId && !clientId) {
      setError("Select a client.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ clientId: lockedClientId ?? clientId, name, typeId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={FileText}
      title="Contract details"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit contract details"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-details-client">Client</Label>
            {lockedClientId ? (
              <Input id="contract-details-client" value={client?.name ?? "—"} readOnly tabIndex={-1} />
            ) : (
              <Select
                id="contract-details-client"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
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
            )}
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="contract-details-name">Name</Label>
            <Input
              id="contract-details-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="contract-details-type">Type</Label>
            <Select
              id="contract-details-type"
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              disabled={loadingOptions}
            >
              <option value="">{defaultType ? `Use default (${defaultType.label})` : "Use organization default"}</option>
              {contractTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Stack>
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
          {
            key: "client",
            label: "Client",
            value: client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : <Text tone="muted">Unknown client</Text>,
          },
          { key: "name", label: "Name", value: <Text>{contract?.name ?? "—"}</Text> },
          {
            key: "type",
            label: "Type",
            value: (
              <Badge color={contract?.contract_type?.color} variant="muted">
                {contract?.contract_type?.label ?? "—"}
              </Badge>
            ),
          },
        ]}
      />
    </EditableSection>
  );
}
