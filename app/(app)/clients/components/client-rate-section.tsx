"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, EditableSection, Inline, Stack, Text } from "@yourorg/ui";
import { Receipt } from "@yourorg/ui/icons";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { RateSettingsSection } from "@/lib/rate-overrides/rate-settings-section";
import type { ClientDraft } from "./client-draft";

export interface ClientRateSectionProps {
  mode: "create" | "edit";
  /** Unique per page (`RateSettingsSection`'s own element ids are built from
   * it) — `"client-rate-details"` on the Details tab, `"new-client-rate"` on
   * the create screen. */
  idPrefix: string;
  draft: Pick<ClientDraft, "hasCustomRate" | "travelArticleId" | "workArticleId" | "travelSalePrice" | "workSalePrice">;
  articles: ArticleSelectOption[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  /** Receives the raw `FormData`-shaped object `RateSettingsSection`'s plain
   * `name`d fields produce (see that component's own doc comment for why
   * it's not a controlled component) — `hasCustomRate` already converted from
   * `"on"`/absent to a real boolean. `mode: "edit"` routes this to
   * `updateClientRateSettings`; `mode: "create"` just merges it into the
   * local draft. */
  onSave: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Rate" section (Client Details tab redo) — the "Custom rate" ("Afwijkend
 * tarief") override, issue #93. Read view always shows the explanatory copy
 * (per the design handoff screenshot) plus an On/Off pill; the edit view
 * wraps the SHARED `RateSettingsSection` (unchanged, also used by the
 * Engineer edit dialog) in its own plain `<form>`, reading `FormData` on
 * submit exactly like `edit-client-panel.tsx`'s old `action()` did — see
 * `RateSettingsSection`'s own doc comment for why it can't be a controlled
 * component instead.
 */
export function ClientRateSection({
  mode,
  idPrefix,
  draft,
  articles,
  editing,
  onEditToggle,
  readOnly,
  onSave,
}: ClientRateSectionProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const input = {
      ...Object.fromEntries(formData.entries()),
      hasCustomRate: formData.get("hasCustomRate") === "on",
    };
    setError(null);
    setSaving(true);
    const result = await onSave(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={Receipt}
      title="Rate"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit rate"
      editContent={
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <RateSettingsSection
              idPrefix={idPrefix}
              initial={{
                hasCustomRate: draft.hasCustomRate,
                travelArticleId: draft.travelArticleId || null,
                workArticleId: draft.workArticleId || null,
                travelSalePrice: draft.travelSalePrice ? Number(draft.travelSalePrice) : null,
                workSalePrice: draft.workSalePrice ? Number(draft.workSalePrice) : null,
              }}
              articles={articles}
              subjectLabel="client"
            />
            <Inline gap="sm" justify="end">
              {mode === "edit" && (
                <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
              )}
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
          <Badge variant={draft.hasCustomRate ? "accent" : "muted"}>{draft.hasCustomRate ? "On" : "Off"}</Badge>
        </Inline>
        <Text tone="muted">
          Override the default Travel-time and Work-time billing articles and sale prices for this client. Purchase
          price always mirrors the picked article and can&rsquo;t be edited here.
        </Text>
      </Stack>
    </EditableSection>
  );
}
