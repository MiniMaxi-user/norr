"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Text } from "@yourorg/ui";
import {
  deleteSolutionSubtype,
  getSolutionSubtypeDependencyCounts,
  type SolutionSubtypeRecord,
} from "@/app/(app)/activities/solution-subtype-actions";

export interface DeleteSolutionSubtypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtype: SolutionSubtypeRecord | null;
}

/**
 * Delete confirmation for a Solution Subtype — a direct mirror of
 * `DeleteArticleGroupDialog`. Calls `getSolutionSubtypeDependencyCounts`
 * first (same `checkDependencies` convention `DeleteClientDialog` establishes)
 * — child subtypes/activities do NOT cascade here (`deleteSolutionSubtype`'s
 * own doc comment: no `on delete cascade`/`set null` at the DB level either),
 * so this warning is a hard blocker, not a cascade-preview.
 */
export function DeleteSolutionSubtypeDialog({ open, onOpenChange, subtype }: DeleteSolutionSubtypeDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${subtype?.name ?? "subtype"}?`}
      checkKey={subtype?.id ?? null}
      checkingMessage="Checking child subtypes and activities…"
      checkDependencies={async () => {
        if (!subtype) return { message: null };
        const result = await getSolutionSubtypeDependencyCounts(subtype.id);
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check child subtypes and activities." };
        }
        const { childSubtypes, activities } = result.data;
        if (childSubtypes > 0 || activities > 0) {
          return {
            message: (
              <Text tone="danger">
                This subtype has {childSubtypes} child subtype{childSubtypes === 1 ? "" : "s"} and {activities}{" "}
                activit{activities === 1 ? "y" : "ies"}. Move or delete{" "}
                {childSubtypes + activities === 1 ? "it" : "them"} first — deleting a subtype with child subtypes or
                activities still assigned isn&rsquo;t allowed.
              </Text>
            ),
          };
        }
        return {
          message: <Text tone="muted">This subtype has no child subtypes or activities. This action cannot be undone.</Text>,
        };
      }}
      onConfirm={async () => {
        if (!subtype) return { error: "No subtype selected." };
        const result = await deleteSolutionSubtype(subtype.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete subtype"
    />
  );
}
