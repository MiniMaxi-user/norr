"use client";

import { FormGrid, Input, KeyValueList, Label, SectionHeader, Stack, Text } from "@yourorg/ui";
import { Phone } from "@yourorg/ui/icons";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityContactSectionProps {
  draft: Pick<ActivityDraft, "contactName" | "contactPhone" | "contactEmail">;
  /** `activity-screen.tsx`'s `sectionEditing` — `true` for any caller who can
   * write at all (there is no separate edit-mode toggle; every gated field
   * is always editable for a writer, per issue #133's follow-up), `false`
   * only for a genuinely `readOnly` viewer. */
  editing: boolean;
  /** Writes straight into the shared `draft` (`activity-screen.tsx`'s
   * `updateDraft`) — no network call from here anymore. */
  onFieldChange: (patch: Partial<Pick<ActivityDraft, "contactName" | "contactPhone" | "contactEmail">>) => void;
}

/**
 * "Contact person" section (`.design-handoff/melding_detail/README.md`) —
 * the Name/Phone/Email override fields that used to live inside
 * `ActivityRelationsDialog` (see that component's own doc comment for why
 * they moved here). Issue #133 removed the local echo state / blur-commit
 * dance (and the `mode === "create"` immediate-commit special case it
 * needed) — every field is now a plain controlled `Input` bound directly to
 * the shared `draft`, writing straight back through `onFieldChange` on every
 * keystroke; a controlled input bound directly to `draft` is never stale, so
 * there's nothing left to commit early to dodge. `!editing` renders the same
 * three fields as plain read text instead.
 */
export function ActivityContactSection({ draft, editing, onFieldChange }: ActivityContactSectionProps) {
  return (
    <Stack gap="md">
      <SectionHeader icon={Phone} title="Contact person" />
      {editing ? (
        <FormGrid columns={3}>
          <Stack gap="xs">
            <Label htmlFor="activity-contact-name">Name</Label>
            <Input
              id="activity-contact-name"
              value={draft.contactName}
              maxLength={200}
              onChange={(event) => onFieldChange({ contactName: event.target.value })}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="activity-contact-phone">Phone</Label>
            <Input
              id="activity-contact-phone"
              value={draft.contactPhone}
              maxLength={50}
              onChange={(event) => onFieldChange({ contactPhone: event.target.value })}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="activity-contact-email">Email</Label>
            <Input
              id="activity-contact-email"
              type="email"
              value={draft.contactEmail}
              maxLength={320}
              onChange={(event) => onFieldChange({ contactEmail: event.target.value })}
            />
          </Stack>
        </FormGrid>
      ) : (
        <KeyValueList
          items={[
            { key: "name", label: "Name", value: <Text>{draft.contactName || "—"}</Text> },
            { key: "phone", label: "Phone", value: <Text>{draft.contactPhone || "—"}</Text> },
            { key: "email", label: "Email", value: <Text>{draft.contactEmail || "—"}</Text> },
          ]}
        />
      )}
      <Text tone="muted" style={{ fontSize: "var(--ui-text-xs)" }}>
        Overgenomen van de contactpersoon bij de client — hier aanpassen geldt alleen voor deze melding.
      </Text>
    </Stack>
  );
}
