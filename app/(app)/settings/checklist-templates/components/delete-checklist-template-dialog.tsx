"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteChecklistTemplate, type ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";

export interface DeleteChecklistTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ChecklistTemplateRecord | null;
}

/**
 * Delete confirmation for a whole checklist template (cascades to its
 * `checklist_template_items` via `on delete cascade`). Any work order that
 * already instantiated this template is unaffected — `checklist_template_id`
 * there is `on delete set null`, so an in-progress/completed instance keeps
 * its own already-snapshotted items regardless (see the migration's design
 * notes) — surfaced here so this isn't mistaken for "deletes the instances
 * too".
 */
export function DeleteChecklistTemplateDialog({ open, onOpenChange, template }: DeleteChecklistTemplateDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!template) return;
    const id = template.id;
    startDeleting(async () => {
      const result = await deleteChecklistTemplate(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this template.");
        return;
      }
      setError(null);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {template?.name ?? "template"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">
            This removes the template and its items as a future option for new checklists. Work orders that already
            attached this template keep their own already-completed checklist untouched.
          </Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
