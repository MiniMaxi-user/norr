"use client";

import { useActionState, useEffect } from "react";
import { inviteTeamMember } from "@/lib/team/actions";
import { TENANT_ROLES } from "@/lib/rbac/permissions";
import { DialogField, SettingsFormDialog, type DialogFormState } from "../../components/settings-dialog-kit";
import { roleLabel } from "./role-label";

interface InviteFormState extends DialogFormState {
  inviteUrl?: string;
}

const initialState: InviteFormState = {};

export interface InviteTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once `inviteTeamMember` succeeds, with the copyable invite link
   * — the parent (`TeamManager`) reveals it and refreshes the pending
   * invites, since this dialog only knows the link. */
  onInvited: (inviteUrl: string) => void;
}

/**
 * "Invite teammate" form — email + role. Success does not just close: it
 * hands the invite link up via `onInvited` so the parent can show it in a
 * reveal-link popup (there is no outbound email in this repo).
 */
export function InviteTeamMemberDialog({ open, onOpenChange, onInvited }: InviteTeamMemberDialogProps) {
  async function action(_prevState: InviteFormState, formData: FormData): Promise<InviteFormState> {
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "");
    const result = await inviteTeamMember(email, role);
    if (result.error || !result.data) {
      return { error: result.error ?? "Could not send the invitation.", fieldErrors: result.fieldErrors };
    }
    return { success: true, inviteUrl: result.data.inviteUrl };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && state.inviteUrl) {
      onOpenChange(false);
      onInvited(state.inviteUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite teammate"
      submitLabel="Send invite"
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="invite-team-member-email" label="Email" errors={state.fieldErrors?.email}>
        <input
          id="invite-team-member-email"
          className="web-input"
          name="email"
          type="email"
          required
          maxLength={320}
        />
      </DialogField>

      <DialogField id="invite-team-member-role" label="Role" errors={state.fieldErrors?.role}>
        <select id="invite-team-member-role" className="web-select" name="role" defaultValue="engineer" required>
          {TENANT_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </DialogField>
    </SettingsFormDialog>
  );
}
