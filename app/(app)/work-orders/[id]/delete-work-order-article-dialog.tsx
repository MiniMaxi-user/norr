"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteWorkOrderArticle, type WorkOrderArticleRecord } from "../work-order-articles-actions";

/**
 * Delete confirmation for a consumed article row. Only ever rendered when
 * `can(actor, "planning", "delete")` (owner/planner) — see
 * `consumed-articles-panel.tsx`. Plain confirm, no dependency-count check,
 * same shape as `../[id]/delete-time-entry-dialog.tsx`.
 */
export function DeleteWorkOrderArticleDialog({
  open,
  onOpenChange,
  workOrderArticle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderArticle: WorkOrderArticleRecord;
}) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete consumed article?"
      onConfirm={async () => {
        const result = await deleteWorkOrderArticle(workOrderArticle.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
