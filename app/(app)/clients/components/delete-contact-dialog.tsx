"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${contact?.name ?? "contact"}?`}
      onConfirm={async () => {
        if (!contact) return { error: "No contact selected." };
        const result = await deleteContact(contact.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete contact"
    />
  );
}
