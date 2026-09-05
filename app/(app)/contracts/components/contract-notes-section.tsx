"use client";

import { useEffect, useState } from "react";
import { Button, Callout, Card, IconButton, Inline, SectionHeader, Stack, Text, Textarea } from "@yourorg/ui";
import { AlignLeft, Pencil } from "@yourorg/ui/icons";
import type { ContractDraft } from "./contract-draft";

export interface ContractNotesSectionProps {
  draft: Pick<ContractDraft, "notes">;
  editing: boolean;
  onEditToggle: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (patch: Pick<ContractDraft, "notes">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Notes" section (issue #122, read view restructured by the Contract detail
 * "1b" layout, docs/designinstructieskanweg/"Contract detail 1b -
 * implementatie.md" section 3) — a warning-tinted `Callout` instead of a
 * `Card` while read-only, since `EditableSection` always wraps its
 * `children` in a plain `Card`; this section builds its own
 * `SectionHeader` + pencil chrome by hand instead of using `EditableSection`
 * so the read view can be a `Callout` rather than a card-within-a-card.
 * Editing itself is unchanged: the same `Textarea` + Save/Cancel toggle,
 * still inside an accent-bordered edit `Card` (`ui-editable-section-card-editing`,
 * the same class `EditableSection` itself uses, so the edit chrome still
 * matches every other section on this page). Mirrors `app/(app)/assets/
 * components/asset-notes-section.tsx` almost verbatim otherwise: a normal
 * bidirectional toggle even in `mode: "create"` (its read view sources
 * straight from `draft.notes`, so it renders correctly closed even before
 * the contract exists).
 */
export function ContractNotesSection({ draft, editing, onEditToggle, readOnly, onSave }: ContractNotesSectionProps) {
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
    <Stack gap="sm">
      <SectionHeader
        icon={AlignLeft}
        title="Notes"
        actions={
          !editing && !readOnly ? (
            <IconButton variant="ghost" aria-label="Edit notes" onClick={() => onEditToggle(true)}>
              <Pencil />
            </IconButton>
          ) : undefined
        }
      />
      {editing ? (
        <Card className="ui-editable-section-card-editing">
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
        </Card>
      ) : (
        <Callout icon={AlignLeft}>{draft.notes ? draft.notes : "No notes yet."}</Callout>
      )}
    </Stack>
  );
}
