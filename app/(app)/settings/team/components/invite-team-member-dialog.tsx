"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, Dialog, Heading, Input, Label, Select, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { inviteTeamMember } from "@/lib/team/actions";
import { TENANT_ROLES } from "@/lib/rbac/permissions";
import { roleLabel } from "./role-label";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  inviteUrl?: string;
}

const initialState: FormState = {};

export interface InviteTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once `inviteTeamMember` succeeds, with the copyable invite link
   * — the parent (`TeamManager`) is responsible for revealing it (same
   * `RevealedLinkDialog` pattern `AccessPanel` uses) and for refreshing the
   * pending-invites list, since this dialog doesn't know the newly-created
   * invite's real id/created-at (only its link). */
  onInvited: (inviteUrl: string) => void;
}

/**
 * "Invite teammate" form — email + role, same `useActionState` shape as
 * `AccountManagerFormDialog`, except success doesn't just close-and-refresh:
 * it hands the returned invite link up to the parent via `onInvited` so the
 * parent can show it in a reveal-link popup (there's no outbound email in
 * this repo — same reasoning as every other invite flow here).
 */
export function InviteTeamMemberDialog({ open, onOpenChange, onInvited }: InviteTeamMemberDialogProps) {
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
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
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Invite teammate</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="invite-team-member-email">Email</Label>
              <Input id="invite-team-member-email" name="email" type="email" required maxLength={320} />
              {state.fieldErrors?.email?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="invite-team-member-role">Role</Label>
              <Select id="invite-team-member-role" name="role" defaultValue="engineer" required>
                {TENANT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </Select>
              {state.fieldErrors?.role?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Sending…" : "Send invite"}
    </Button>
  );
}
