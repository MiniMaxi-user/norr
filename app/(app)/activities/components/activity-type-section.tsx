"use client";

import { useMemo } from "react";
import { IconTileSelect, SectionHeader, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { resolveActivityTypeIcon } from "../icon-map";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityTypeSectionProps {
  typeId: string;
  activityTypes: ReferenceListItemRecord[];
  /** `activity-screen.tsx`'s `sectionEditing` — `true` for any caller who can
   * write at all (there is no separate edit-mode toggle; every gated field
   * is always editable for a writer, per issue #133's follow-up), `false`
   * only for a genuinely `readOnly` viewer. */
  editing: boolean;
  /** Writes straight into the shared `draft` (`activity-screen.tsx`'s
   * `updateDraft`) — no network call from here anymore. Persistence is
   * deferred to the page's own Save (`mode: "edit"`) or "Create activity"
   * (`mode: "create"`). */
  onFieldChange: (patch: Pick<ActivityDraft, "typeId">) => void;
}

/**
 * "Type" section (`.design-handoff/melding_detail/README.md`) — the
 * `IconTileSelect` of the 5 `activity_type` options that used to live inside
 * `ActivityRelationsDialog`. Issue #133 removed this section's own instant
 * per-click `updateActivity` round trip (and the optimistic-select/
 * revert-on-error dance that only existed to paper over that instant save):
 * `!editing` renders a plain read-only `Text` of the selected type, `editing`
 * renders the same `IconTileSelect` as before, but now just merging the pick
 * into the shared `draft` — persisted once by the page's own Save, alongside
 * every other field.
 */
export function ActivityTypeSection({ typeId, activityTypes, editing, onFieldChange }: ActivityTypeSectionProps) {
  const typeOptions = useMemo(
    () =>
      activityTypes.map((item) => {
        const TypeIcon = resolveActivityTypeIcon(item.icon);
        return { value: item.id, label: item.label, icon: <TypeIcon /> };
      }),
    [activityTypes],
  );

  const selectedType = activityTypes.find((item) => item.id === typeId);

  return (
    <Stack gap="md">
      <SectionHeader icon={AlertTriangle} title="Type" />
      {editing ? (
        <IconTileSelect
          options={typeOptions}
          value={typeId}
          onChange={(nextTypeId) => onFieldChange({ typeId: nextTypeId })}
          aria-label="Activity type"
        />
      ) : (
        <Text>{selectedType?.label ?? "No type selected yet."}</Text>
      )}
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
