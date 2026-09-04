"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { ShieldCheck } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDate } from "@/lib/format/date";
import type { AssetDraft } from "./asset-draft";

export interface AssetStatusWarrantySectionProps {
  mode: "create" | "edit";
  draft: Pick<AssetDraft, "statusId" | "installedAt" | "warrantyUntil">;
  /** Edit mode only — the read view's Status badge sources its color/label
   * straight from this already-resolved record, same reasoning
   * `AssetEquipmentSection`'s doc comment gives for its own read view. */
  asset?: AssetRecord;
  assetStatuses: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (patch: Pick<AssetDraft, "statusId" | "installedAt" | "warrantyUntil">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Status & warranty" section (asset new/edit design handoff v3) — same
 * read-card/accent-edit-card toggle as `AssetEquipmentSection`, see that
 * component's doc comment for the create/edit mode behavior split.
 */
export function AssetStatusWarrantySection({
  mode,
  draft,
  asset,
  assetStatuses,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: AssetStatusWarrantySectionProps) {
  const [statusId, setStatusId] = useState(draft.statusId);
  const [installedAt, setInstalledAt] = useState(draft.installedAt);
  const [warrantyUntil, setWarrantyUntil] = useState(draft.warrantyUntil);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setStatusId(draft.statusId);
    setInstalledAt(draft.installedAt);
    setWarrantyUntil(draft.warrantyUntil);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const defaultStatus = assetStatuses.find((item) => item.is_default);

  function handleCancel() {
    setStatusId(draft.statusId);
    setInstalledAt(draft.installedAt);
    setWarrantyUntil(draft.warrantyUntil);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ statusId, installedAt, warrantyUntil });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={ShieldCheck}
      title="Status & warranty"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit status"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="asset-sw-status">Status</Label>
              <Select
                id="asset-sw-status"
                value={statusId}
                onChange={(event) => setStatusId(event.target.value)}
                disabled={loadingOptions}
              >
                <option value="">{defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}</option>
                {assetStatuses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-sw-installed">Installed on</Label>
              <Input
                id="asset-sw-installed"
                type="date"
                value={installedAt}
                onChange={(event) => setInstalledAt(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-sw-warranty">Warranty until</Label>
              <Input
                id="asset-sw-warranty"
                type="date"
                value={warrantyUntil}
                onChange={(event) => setWarrantyUntil(event.target.value)}
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
          {
            key: "status",
            label: "Status",
            value: (
              <Badge color={asset?.asset_status?.color} variant="muted">
                {asset?.asset_status?.label ?? "—"}
              </Badge>
            ),
          },
          { key: "installed", label: "Installed on", value: <Text>{formatDate(asset?.installed_at ?? null, { month: "long" })}</Text> },
          {
            key: "warranty",
            label: "Warranty until",
            value: <Text>{formatDate(asset?.warranty_until ?? null, { month: "long" })}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
