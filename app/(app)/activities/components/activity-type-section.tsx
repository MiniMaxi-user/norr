"use client";

import { useEffect, useMemo, useState } from "react";
import { IconTileSelect, SectionHeader, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { resolveActivityTypeIcon } from "../icon-map";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityTypeSectionProps {
  typeId: string;
  activityTypes: ReferenceListItemRecord[];
  readOnly?: boolean;
  onSave: (patch: Pick<ActivityDraft, "typeId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Type" section (`.design-handoff/melding_detail/README.md`) — the
 * `IconTileSelect` of the 5 `activity_type` options that used to live inside
 * `ActivityRelationsDialog`, now its own always-visible section that saves
 * the instant a tile is clicked ("Type wisselen valideert direct" — no
 * separate Save button). Optimistically shows the newly-picked tile before
 * the save round-trips; reverts back to the last-committed value and surfaces
 * the server's error inline if the save is rejected (e.g. switching to
 * Storing/Onderhoud with no asset set — `validate_activity_relations`'s DB
 * check, surfaced as a clean field error by `updateActivity`). Local
 * `selectedId` mirrors the `typeId` prop via effect (same "self-heals back to
 * the real prop" pattern `ActivityScreen`'s own `scopingClientId` uses) so a
 * save that lands from elsewhere stays in sync.
 */
export function ActivityTypeSection({ typeId, activityTypes, readOnly, onSave }: ActivityTypeSectionProps) {
  const [selectedId, setSelectedId] = useState(typeId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(typeId);
  }, [typeId]);

  const typeOptions = useMemo(
    () =>
      activityTypes.map((item) => {
        const TypeIcon = resolveActivityTypeIcon(item.icon);
        return { value: item.id, label: item.label, icon: <TypeIcon /> };
      }),
    [activityTypes],
  );

  async function handleChange(nextTypeId: string) {
    if (readOnly || nextTypeId === selectedId) return;
    const previous = selectedId;
    setSelectedId(nextTypeId);
    setError(null);
    const result = await onSave({ typeId: nextTypeId });
    if (!result.ok) {
      setSelectedId(previous);
      setError(result.error ?? "Could not change the activity type.");
    }
  }

  return (
    <Stack gap="md">
      <SectionHeader icon={AlertTriangle} title="Type" />
      {error && <Text tone="danger">{error}</Text>}
      <IconTileSelect
        options={typeOptions}
        value={selectedId}
        onChange={handleChange}
        aria-label="Activity type"
        disabled={readOnly}
      />
      {/* Exact copy + styling from the mockup — `Text` has no `size="xs"`
          prop (see `packages/ui/src/components/typography.tsx`), so this
          matches the raw CSS the design handoff specifies directly via the
          same design token, rather than adding a one-off size variant for a
          single caller. */}
      <Text tone="muted" style={{ fontSize: "var(--ui-text-xs)" }}>
        Asset is required for Storing or Onderhoud activities.
      </Text>
    </Stack>
  );
}
