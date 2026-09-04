"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CascadingSelect,
  EditableSection,
  Button,
  Input,
  KeyValueList,
  Label,
  FormGrid,
  Inline,
  Select,
  Stack,
  Text,
} from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { AssetDraft } from "./asset-draft";

export interface AssetEquipmentSectionProps {
  mode: "create" | "edit";
  draft: Pick<AssetDraft, "serialNumber" | "name" | "typeId" | "subtypeId" | "externalReference">;
  /** Edit mode only — the read view renders straight off this already-
   * resolved record (its own `asset_type`/`asset_subtype` embeds), same
   * "read view sources from the server record, edit view from local state"
   * split `WorkOrderHero`'s badges use. */
  asset?: AssetRecord;
  assetTypes: ReferenceListItemRecord[];
  assetSubtypes: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (
    patch: Pick<AssetDraft, "serialNumber" | "name" | "typeId" | "subtypeId" | "externalReference">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Equipment" section (asset new/edit design handoff v3) — read-only
 * key/value card (Serial number, Asset ID, Type / sub-type, External
 * reference) that swaps for an accent-bordered inline-edit card on the
 * header pencil. In `mode: "create"` this always renders the edit card (no
 * pencil, nothing to toggle back to yet — `AssetScreen` keeps `editing` fixed
 * `true` for the whole create flow, mirroring `WorkOrderScreen`'s "sections
 * just accumulate into local draft state" create-mode pattern) with no
 * Cancel action (there is no prior saved state to revert to); in
 * `mode: "edit"` Save persists immediately via `onSave` (`AssetScreen`'s
 * `commitPatch`) and closes back to the read card, Cancel discards the local
 * edits and closes without saving.
 */
export function AssetEquipmentSection({
  mode,
  draft,
  asset,
  assetTypes,
  assetSubtypes,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: AssetEquipmentSectionProps) {
  const [serialNumber, setSerialNumber] = useState(draft.serialNumber);
  const [name, setName] = useState(draft.name);
  const [typeId, setTypeId] = useState(draft.typeId);
  const [subtypeId, setSubtypeId] = useState(draft.subtypeId);
  const [externalReference, setExternalReference] = useState(draft.externalReference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local field state from the draft every time this section (re-)
  // opens for editing — covers both a fresh popup-like open (edit mode) and
  // the initial mount in create mode.
  useEffect(() => {
    if (!editing) return;
    setSerialNumber(draft.serialNumber);
    setName(draft.name);
    setTypeId(draft.typeId);
    setSubtypeId(draft.subtypeId);
    setExternalReference(draft.externalReference);
    setError(null);
    // Only re-seed on the open transition itself, not on every draft change
    // while already open (that would clobber in-progress typing) — same
    // "open re-seeds, not every keystroke" contract every other inline
    // edit/dialog in this codebase already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const subtypeCascadeOptions = useMemo(
    () => assetSubtypes.map((item) => ({ id: item.id, label: item.label, parentId: item.parent_item_id ?? "" })),
    [assetSubtypes],
  );

  function handleTypeChange(nextTypeId: string) {
    setTypeId(nextTypeId);
    setSubtypeId((prev) => {
      if (!prev) return prev;
      const item = assetSubtypes.find((candidate) => candidate.id === prev);
      return item?.parent_item_id === nextTypeId ? prev : "";
    });
  }

  function handleCancel() {
    setSerialNumber(draft.serialNumber);
    setName(draft.name);
    setTypeId(draft.typeId);
    setSubtypeId(draft.subtypeId);
    setExternalReference(draft.externalReference);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    if (!typeId) {
      setError("Type is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ serialNumber, name, typeId, subtypeId, externalReference });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  const typeSubtypeLabel = [asset?.asset_type?.label, asset?.asset_subtype?.label].filter(Boolean).join(" / ");

  return (
    <EditableSection
      icon={Boxes}
      title="Equipment"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit equipment"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="asset-eq-serial">Serial number</Label>
              <Input
                id="asset-eq-serial"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
                maxLength={200}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-eq-name">Asset ID</Label>
              <Input
                id="asset-eq-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                placeholder="Leave blank to auto-generate, e.g. AST-00042"
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-eq-type">Type</Label>
              <Select
                id="asset-eq-type"
                value={typeId}
                onChange={(event) => handleTypeChange(event.target.value)}
                disabled={loadingOptions}
                required
              >
                <option value="" disabled>
                  Select a type…
                </option>
                {assetTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-eq-subtype">Sub-type</Label>
              <CascadingSelect
                id="asset-eq-subtype"
                value={subtypeId}
                onChange={(event) => setSubtypeId(event.target.value)}
                parentValue={typeId}
                options={subtypeCascadeOptions}
                placeholder="No sub-type"
                emptyParentPlaceholder="Select a type first…"
                disabled={loadingOptions}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-eq-external">External reference</Label>
              <Input
                id="asset-eq-external"
                value={externalReference}
                onChange={(event) => setExternalReference(event.target.value)}
                maxLength={200}
              />
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
          { key: "serial", label: "Serial number", value: <Text>{asset?.serial_number ?? "—"}</Text> },
          { key: "asset-id", label: "Asset ID", value: <Text>{asset?.name ?? "—"}</Text> },
          { key: "type", label: "Type / sub-type", value: <Text>{typeSubtypeLabel || "—"}</Text> },
          {
            key: "external-reference",
            label: "External reference",
            value: <Text>{asset?.external_reference ?? "—"}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
