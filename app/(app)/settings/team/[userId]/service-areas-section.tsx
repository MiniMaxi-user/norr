"use client";

import { useState } from "react";
import { Badge, Button, Checkbox, EditableSection, Inline, Label, Stack, Text } from "@yourorg/ui";
import { Globe } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { updateTeamMemberWorkRegions } from "@/lib/team/actions";

export interface ServiceAreasSectionProps {
  userId: string;
  /** `TeamMemberRecord.workRegionIds` — the ADDITIONAL Service Areas this
   * membership carries, on top of (not instead of) the independent Default
   * Service Area above. */
  regionIds: string[];
  /** `listReferenceItems("region")`'s result, fetched once by `page.tsx` —
   * every region item renders as its own checkbox, independent of whichever
   * one is picked as the default (no force-include/dedupe against it, per
   * `TeamMemberRecord.workRegionIds`'s own doc comment). */
  regions: ReferenceListItemRecord[];
  readOnly?: boolean;
  /** Called once a save succeeds, with the member's fresh (saved) full set
   * of work-region ids. */
  onSaved: (regionIds: string[]) => void;
}

const HELPER_TEXT = "Additional areas this engineer can be scheduled in, besides their default above.";

/**
 * "Service Areas" (work regions) section (issue #192, new) — a full-replace
 * multi-select (plain checkboxes, one per `region` reference item) bound to
 * `membership_work_regions` via `updateTeamMemberWorkRegions`. Same
 * `EditableSection` toggle shape as `RateOverridesSection`/
 * `DefaultServiceAreaSection` on this page, but with a checkbox list instead
 * of a single `<Select>` since this is a many-value field.
 */
export function ServiceAreasSection({ userId, regionIds, regions, readOnly, onSaved }: ServiceAreasSectionProps) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(regionIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleEdit() {
    setSelected(new Set(regionIds));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setSelected(new Set(regionIds));
    setError(null);
    setEditing(false);
  }

  function toggleRegion(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await updateTeamMemberWorkRegions(userId, Array.from(selected));
    setSaving(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not save Service Areas.");
      return;
    }
    onSaved(result.data.regionIds);
    setEditing(false);
  }

  const selectedRegions = regions.filter((region) => regionIds.includes(region.id));

  return (
    <EditableSection
      icon={Globe}
      title="Service Areas"
      editing={editing}
      onEdit={readOnly ? undefined : handleEdit}
      editLabel="Edit Service Areas"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">{HELPER_TEXT}</Text>
          <Stack gap="xs">
            {regions.length === 0 && <Text tone="muted">No Service Areas configured yet.</Text>}
            {regions.map((region) => (
              <Inline key={region.id} gap="sm" align="center">
                <Checkbox
                  id={`team-member-service-area-${region.id}`}
                  checked={selected.has(region.id)}
                  onChange={(event) => toggleRegion(region.id, event.target.checked)}
                />
                <Label htmlFor={`team-member-service-area-${region.id}`}>{region.label}</Label>
              </Inline>
            ))}
          </Stack>
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
      <Stack gap="sm">
        <Text tone="muted">{HELPER_TEXT}</Text>
        {selectedRegions.length > 0 ? (
          <Inline gap="xs" wrap>
            {selectedRegions.map((region) => (
              <Badge key={region.id} variant="muted">
                {region.label}
              </Badge>
            ))}
          </Inline>
        ) : (
          <Text tone="muted">No additional Service Areas assigned.</Text>
        )}
      </Stack>
    </EditableSection>
  );
}
