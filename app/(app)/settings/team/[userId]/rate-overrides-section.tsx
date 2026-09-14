"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, EditableSection, Inline, Stack, Text } from "@yourorg/ui";
import { Receipt } from "@yourorg/ui/icons";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { RateSettingsSection } from "@/lib/rate-overrides/rate-settings-section";
import type { RateOverrideRecord } from "@/lib/rate-overrides/schema";
import { updateTeamMemberRateSettings } from "@/lib/team/actions";

export interface RateOverridesSectionProps {
  userId: string;
  rateSettings: RateOverrideRecord;
  /** `listArticlesForSelect()`'s result, fetched once by `page.tsx` — see
   * `RateSettingsSection`'s own doc comment. */
  articles: ArticleSelectOption[];
  readOnly?: boolean;
  /** Called once a save succeeds, with the member's fresh (saved) rate
   * settings, so the page can patch its local state without a full
   * `router.refresh()`. */
  onSaved: (rateSettings: RateOverrideRecord) => void;
}

/**
 * "Rate overrides" section (issue #93, relocated here from
 * `EditTeamMemberDialog` by issue #192 — see this route's `page.tsx` header
 * comment) — same read-card/accent-edit-card `EditableSection` toggle
 * `ClientRateSection` (`app/(app)/clients/components/client-rate-section.tsx`)
 * uses for the identical shared shape on a client. Only ever rendered for an
 * `engineer` row — this component doesn't re-check that itself, the caller
 * (`team-member-detail.tsx`) gates it, same as `EditTeamMemberDialog` did
 * before.
 */
export function RateOverridesSection({ userId, rateSettings, articles, readOnly, onSaved }: RateOverridesSectionProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    setEditing(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const formData = new FormData(event.currentTarget);
    // A `<Checkbox>` only appears in `FormData` at all when checked — see
    // `RateSettingsSection`'s own doc comment.
    const input = {
      ...Object.fromEntries(formData.entries()),
      hasCustomRate: formData.get("hasCustomRate") === "on",
    };
    const result = await updateTeamMemberRateSettings(userId, input);
    setSaving(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not save rate settings.");
      return;
    }
    onSaved(result.data);
    setEditing(false);
  }

  return (
    <EditableSection
      icon={Receipt}
      title="Rate overrides"
      editing={editing}
      onEdit={readOnly ? undefined : () => setEditing(true)}
      editLabel="Edit rate overrides"
      editContent={
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <RateSettingsSection
              idPrefix="team-member-rate"
              initial={rateSettings}
              articles={articles}
              subjectLabel="engineer"
            />
            <Inline gap="sm" justify="end">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Inline>
          </Stack>
        </form>
      }
    >
      <Stack gap="sm">
        <Inline justify="between" align="center">
          <Text>Custom rate</Text>
          <Badge variant={rateSettings.hasCustomRate ? "accent" : "muted"}>
            {rateSettings.hasCustomRate ? "On" : "Off"}
          </Badge>
        </Inline>
        <Text tone="muted">
          Override the default Travel-time and Work-time billing articles and sale prices for this engineer.
          Purchase price always mirrors the picked article and can&rsquo;t be edited here.
        </Text>
      </Stack>
    </EditableSection>
  );
}
