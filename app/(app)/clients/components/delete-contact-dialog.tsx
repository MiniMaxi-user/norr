"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteContact, type ContactRecord } from "../contacts-actions";

/**
 * Delete confirmation for a contact. Unlike `DeleteClientDialog`/
 * `DeleteSiteDialog`, there's no dependency-count check to run first — per
 * `deleteContact`'s doc comment in `contacts-actions.ts`, a contact has no
 * children, so this is a plain confirm (same shape as `DeleteAssetDialog`/
 * `DeleteReferenceItemDialog`).
 */
export function DeleteContactDialog({
  open,
  onOpenChange,
  contact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactRecord | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!contact) return;
    const id = contact.id;
    startDeleting(async () => {
      const result = await deleteContact(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this contact.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {contact?.name ?? "contact"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">This cannot be undone.</Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete contact"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
