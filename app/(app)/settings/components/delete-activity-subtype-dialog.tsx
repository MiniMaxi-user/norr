"use client";

import {
  deleteActivitySubtype,
  getActivitySubtypeDependencyCounts,
  type ActivitySubtypeRecord,
} from "@/app/(app)/activities/subtypes-actions";
import { SettingsDeleteDialog } from "./settings-dialog-kit";

export interface DeleteActivitySubtypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtype: ActivitySubtypeRecord | null;
}

/**
 * Delete confirmation for an Activity Subtype. Checks child subtypes and
 * activities first: they do not cascade, so a subtype that still has either
 * cannot be deleted (the server rejects it; the message says why up front).
 */
export function DeleteActivitySubtypeDialog({ open, onOpenChange, subtype }: DeleteActivitySubtypeDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${subtype?.name ?? "subtype"}?`}
      checkingMessage="Checking child subtypes and activities…"
      checkDependencies={async () => {
        if (!subtype) return { message: null };
        const result = await getActivitySubtypeDependencyCounts(subtype.id);
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check child subtypes and activities." };
        }
        const { childSubtypes, activities } = result.data;
        if (childSubtypes > 0 || activities > 0) {
          return {
            message: (
              <span style={{ color: "var(--danger-text)" }}>
                This subtype has {childSubtypes} child subtype{childSubtypes === 1 ? "" : "s"} and {activities}{" "}
                activit{activities === 1 ? "y" : "ies"}. Move or delete{" "}
                {childSubtypes + activities === 1 ? "it" : "them"} first — deleting a subtype with child subtypes or
                activities still assigned isn&rsquo;t allowed.
              </span>
            ),
          };
        }
        return { message: "This subtype has no child subtypes or activities. This action cannot be undone." };
      }}
      onConfirm={async () => {
        if (!subtype) return { error: "No subtype selected." };
        const result = await deleteActivitySubtype(subtype.id);
        return { error: result.error };
      }}
    />
  );
}
