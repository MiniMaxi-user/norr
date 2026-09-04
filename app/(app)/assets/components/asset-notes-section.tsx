"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, Inline, Stack, Text, Textarea } from "@yourorg/ui";
import { AlignLeft } from "@yourorg/ui/icons";
import type { AssetDraft } from "./asset-draft";

export interface AssetNotesSectionProps {
  draft: Pick<AssetDraft, "notes">;
  editing: boolean;
  onEditToggle: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (patch: Pick<AssetDraft, "notes">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Notes" section (asset new/edit design handoff v3) — plain text card, or a
 * `Textarea` + Save/Cancel while editing. Unlike Equipment/Status & warranty,
 * Notes stays a normal bidirectional toggle even in `mode: "create"` (it
 * isn't part of the "start open" instruction — see `INSTRUCTIONS-v3.md`'s
 * "Nieuw-modus" section, which only calls out Equipment/Status & warranty):
 * its read view sources straight from `draft.notes` (not a saved `asset`
 * record), so it renders correctly closed even before the asset exists.
 */
export function AssetNotesSection({ draft, editing, onEditToggle, readOnly, onSave }: AssetNotesSectionProps) {
  const [notes, setNotes] = useState(draft.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setNotes(draft.notes);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setNotes(draft.notes);
    setError(null);
    onEditToggle(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ notes });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onEditToggle(false);
  }

  return (
    <EditableSection
      icon={AlignLeft}
      title="Notes"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle(true)}
      editLabel="Edit notes"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} aria-label="Notes" />
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
      {draft.notes ? <Text>{draft.notes}</Text> : <Text tone="muted">No notes yet.</Text>}
    </EditableSection>
  );
}
