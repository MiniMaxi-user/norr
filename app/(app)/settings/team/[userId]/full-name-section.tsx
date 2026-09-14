"use client";

import { useState, type FormEvent } from "react";
import { Button, EditableSection, Inline, Input, Label, Stack, Text } from "@yourorg/ui";
import { UserRound } from "@yourorg/ui/icons";
import { updateTeamMemberProfile } from "@/lib/team/actions";

export interface FullNameSectionProps {
  userId: string;
  fullName: string | null;
  readOnly?: boolean;
  /** Called once a save succeeds, with the member's fresh (saved) full name,
   * so the page can patch its local state without a full `router.refresh()`. */
  onSaved: (fullName: string) => void;
}

/**
 * "Name" section (issue #192 follow-up) — relocated here from the now-removed
 * `EditTeamMemberDialog`, the last field that still lived in a popup. Same
 * `EditableSection` toggle shape as every other section on this page
 * (`RateOverridesSection`/`DefaultServiceAreaSection`/`ServiceAreasSection`).
 */
export function FullNameSection({ userId, fullName, readOnly, onSaved }: FullNameSectionProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    setFieldError(null);
    setEditing(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    setSaving(true);
    const formData = new FormData(event.currentTarget);
    const result = await updateTeamMemberProfile(userId, { fullName: String(formData.get("fullName") ?? "") });
    setSaving(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not save this name.");
      setFieldError(result.fieldErrors?.fullName?.[0] ?? null);
      return;
    }
    onSaved(result.data.fullName);
    setEditing(false);
  }

  return (
    <EditableSection
      icon={UserRound}
      title="Name"
      editing={editing}
      onEdit={readOnly ? undefined : () => setEditing(true)}
      editLabel="Edit name"
      editContent={
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <Stack gap="xs">
              <Label htmlFor="team-member-full-name">Full name</Label>
              <Input id="team-member-full-name" name="fullName" defaultValue={fullName ?? ""} required maxLength={200} />
              {fieldError && <Text tone="danger">{fieldError}</Text>}
            </Stack>
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
      <Text>{fullName || "No name set"}</Text>
    </EditableSection>
  );
}
