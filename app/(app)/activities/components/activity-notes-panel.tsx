"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text, Textarea } from "@yourorg/ui";
import { WebButton, WebCard } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import { memberDisplayName } from "@/lib/members/format";
import { createActivityNote, type ActivityNoteRecord } from "../notes-actions";

export interface ActivityNotesPanelProps {
  activityId: string;
  /** Newest first (`listActivityNotes`'s own order). */
  notes: ActivityNoteRecord[];
  /** No update permission: notes can be read but not added. */
  readOnly?: boolean;
}

/**
 * Notes tab of the Activity page (design system, issue #222) — a feed of the
 * activity's notes, newest first, each with its author and date. "+ Note" in
 * the card head opens a small dialog (a note is a small sub-entity, so a
 * dialog is the right weight); it is omitted for a read-only viewer.
 */
export function ActivityNotesPanel({ activityId, notes, readOnly }: ActivityNotesPanelProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="web-tab-stack">
      <WebCard
        title="Notes"
        meta={String(notes.length)}
        action={
          readOnly ? undefined : (
            <WebButton size="sm" onClick={() => setDialogOpen(true)}>
              + Note
            </WebButton>
          )
        }
      >
        {notes.length === 0 ? (
          <p className="web-card-text" data-empty="true">
            {readOnly ? "No notes yet" : "No notes yet. Use + Note to add the first one."}
          </p>
        ) : (
          <ul className="web-note-list">
            {notes.map((note) => (
              <li key={note.id} className="web-note">
                <p className="web-note-text">{note.body}</p>
                <p className="web-note-meta">
                  {note.created_by_user ? `${memberDisplayName(note.created_by_user)} · ` : ""}
                  {formatDateTimeWeb(note.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </WebCard>

      {dialogOpen && (
        <AddNoteDialog open onOpenChange={setDialogOpen} activityId={activityId} onAdded={() => router.refresh()} />
      )}
    </div>
  );
}

function AddNoteDialog({
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
        <Button type="button" variant="primary" disabled={isPending || !body.trim()} onClick={handleAdd}>
          {isPending ? "Adding…" : "Add note"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
