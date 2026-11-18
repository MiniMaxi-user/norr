"use client";

import { removeTeamMember, type TeamMemberRecord } from "@/lib/team/actions";
import { SettingsDeleteDialog } from "../../components/settings-dialog-kit";

export interface RemoveTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberRecord | null;
  /** Called once `removeTeamMember` succeeds. */
  onRemoved: (userId: string) => void;
}

/**
 * Confirmation for removing a teammate's membership. `removeTeamMember`
 * itself rejects self-removal and last-owner removal server-side; that error
 * is shown inline in the dialog rather than failing silently.
 */
export function RemoveTeamMemberDialog({ open, onOpenChange, member, onRemoved }: RemoveTeamMemberDialogProps) {
  const name = member?.fullName || member?.email || "this teammate";

  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${name}?`}
      confirmLabel="Remove"
      onConfirm={async () => {
        if (!member) return { error: "No teammate selected." };
        const result = await removeTeamMember(member.userId);
        return { error: result.error };
      }}
      onDeleted={() => {
        if (member) onRemoved(member.userId);
      }}
    >
      This revokes their access to your organization. This cannot be undone — they would need a new invitation to
      rejoin.
    </SettingsDeleteDialog>
  );
}
