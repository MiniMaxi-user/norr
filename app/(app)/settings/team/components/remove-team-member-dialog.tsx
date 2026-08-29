"use client";

import { ConfirmDeleteDialog } from "@yourorg/ui";
import { removeTeamMember, type TeamMemberRecord } from "@/lib/team/actions";

export interface RemoveTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberRecord | null;
  /** Called once `removeTeamMember` succeeds — `TeamManager` drops the row
   * from its local list. */
  onRemoved: (userId: string) => void;
}

/**
 * Delete confirmation for a teammate's membership — reuses the shared
 * `ConfirmDeleteDialog` (issue #77) rather than a one-off dialog, same as
 * `DeleteAccountManagerDialog`/`DeleteChecklistTemplateDialog`. No dependency
 * check needed (no `checkDependencies`): `removeTeamMember` itself already
 * rejects self-removal and last-owner removal server-side, and that failure
 * surfaces through this dialog's own built-in error display — exactly what
 * "surface the last-owner guard, don't fail silently" means here.
 */
export function RemoveTeamMemberDialog({ open, onOpenChange, member, onRemoved }: RemoveTeamMemberDialogProps) {
  const name = member?.fullName || member?.email || "this teammate";

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${name}?`}
      fallbackMessage="This revokes their access to your organization. This cannot be undone — they would need a new invitation to rejoin."
      onConfirm={async () => {
        if (!member) return { error: "No teammate selected." };
        const result = await removeTeamMember(member.userId);
        return { error: result.error };
      }}
      onDeleted={() => {
        if (member) onRemoved(member.userId);
      }}
      confirmLabel="Remove"
      deletingLabel="Removing…"
    />
  );
}
