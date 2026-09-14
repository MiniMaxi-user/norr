"use client";

import { useState } from "react";
import { Badge, Button, EditableSection, Inline, Select, Stack, Text } from "@yourorg/ui";
import { MapPin } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { updateTeamMemberRegion } from "@/lib/team/actions";

export interface DefaultServiceAreaSectionProps {
  userId: string;
  regionId: string | null;
  /** `listReferenceItems("region")`'s result, fetched once by `page.tsx`. */
  regions: ReferenceListItemRecord[];
  readOnly?: boolean;
  /** Called once a save succeeds, with the member's fresh (saved) default
   * Service Area id. */
  onSaved: (regionId: string | null) => void;
}

/**
 * "Default Service Area" section (issue #192, relocated here from
 * `EditTeamMemberDialog`'s "Region" `<Select>`) — single-value default
 * (`memberships.region_id`, `updateTeamMemberRegion`), independent of the
 * "Service Areas" (work regions) section below it. Same `EditableSection`
 * toggle shape as `RateOverridesSection`/`ServiceAreasSection` on this page.
 */
export function DefaultServiceAreaSection({
  userId,
  regionId,
  regions,
  readOnly,
  onSaved,
}: DefaultServiceAreaSectionProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(regionId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleEdit() {
    setValue(regionId ?? "");
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setValue(regionId ?? "");
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await updateTeamMemberRegion(userId, value === "" ? null : value);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved(result.data?.regionId ?? null);
    setEditing(false);
  }

  const regionLabel = regions.find((region) => region.id === regionId)?.label ?? null;

  return (
    <EditableSection
      icon={MapPin}
      title="Default Service Area"
      editing={editing}
      onEdit={readOnly ? undefined : handleEdit}
      editLabel="Edit default Service Area"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Select aria-label="Default Service Area" value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="">No default Service Area</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </Select>
          <Inline gap="sm" justify="end">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Inline>
        </Stack>
      }
    >
      <Stack gap="xs">
        {regionLabel ? (
          <Badge variant="accent">{regionLabel}</Badge>
        ) : (
          <Text tone="muted">No default Service Area set</Text>
        )}
      </Stack>
    </EditableSection>
  );
}
