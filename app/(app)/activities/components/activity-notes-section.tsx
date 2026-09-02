"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Dialog, SectionHeader, Stack, Text, Textarea } from "@yourorg/ui";
import { AlertTriangle, AlignLeft } from "@yourorg/ui/icons";
import { createActivityNote, type ActivityNoteRecord } from "../notes-actions";

export interface ActivityNotesSectionProps {
  activityId: string;
  notes: ActivityNoteRecord[];
  readOnly?: boolean;
}

/**
 * "Notes" section (`.design-handoff/melding_detail/README.md`) — `mode:
 * "edit"` only (an activity being created has no id to attach notes to yet).
 * A feed of warning-tinted `Callout`s, newest first (`listActivityNotes`'s
 * own order), fed by `[id]/page.tsx`.
 *
 * *** Empty-state judgment call *** — the handoff says "no notes → leave the
 * section out entirely, not an empty card," but a caller who CAN add the
 * first note still needs the header + "+ Note" button to exist somewhere.
 * Reconciled as: `ActivityScreen` renders this component at all only when
 * `!readOnly || notes.length > 0` (see that component's own render site) —
 * a read-only viewer with zero notes never sees an empty "Notes" section,
 * but anyone who can actually add one always does, even before the first
 * note exists. Inside here, the `Callout` list itself is simply omitted
 * (not an `EmptyState`) when `notes` is empty, since the section's own
 * header + "+ Note" button already communicate "nothing here yet, add one."
 *
 * "+ Note" opens a small `Dialog` with a `Textarea` + outline "Add note"
 * button, mirroring `WorkOrderChecklistSection`'s own "add an item" sub-flow
 * (an `Input` + outline `Button` inside its "Edit checklist" `Dialog`) — the
 * closest existing "add a small child row" precedent in this app.
 */
export function ActivityNotesSection({ activityId, notes, readOnly }: ActivityNotesSectionProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Stack gap="md">
      <SectionHeader
        icon={AlignLeft}
        title="Notes"
        actions={
          !readOnly && (
            <Button type="button" variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
              + Note
            </Button>
          )
        }
      />

      {notes.length > 0 && (
        <Stack gap="xs">
          {notes.map((note) => (
            <Callout icon={AlertTriangle} key={note.id}>
              {note.body}
            </Callout>
          ))}
        </Stack>
      )}

      {dialogOpen && (
        <ActivityAddNoteDialog
          open
          onOpenChange={setDialogOpen}
          activityId={activityId}
          onAdded={() => router.refresh()}
        />
      )}
    </Stack>
  );
}

function ActivityAddNoteDialog({
  open,
  onOpenChange,
  activityId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string;
  onAdded: () => void;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await createActivityNote(activityId, body);
      if (!result.data) {
        setError(result.error ?? "Could not add this note.");
        return;
      }
      onAdded();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Add note</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Textarea
            aria-label="Note text"
            rows={4}
            placeholder="Add a note…"
            value={body}
            disabled={isPending}
            onChange={(event) => setBody(event.target.value)}
          />
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={isPending || !body.trim()} onClick={handleAdd}>
          {isPending ? "Adding…" : "Add note"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
