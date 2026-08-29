"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, Dialog, Heading, Input, Label, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { updateTeamMemberProfile, type TeamMemberRecord } from "@/lib/team/actions";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  fullName?: string;
}

const initialState: FormState = {};

export interface EditTeamMemberNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberRecord | null;
  /** Called with the saved name once `updateTeamMemberProfile` succeeds, so
   * `TeamManager` can update its local member list without a full
   * `router.refresh()`. */
  onSaved: (userId: string, fullName: string) => void;
}

/**
 * Small popup to edit a TEAMMATE's display name (not the caller's own —
 * that's the separate `/profile` page) — same `size="sm"` single-field-form
 * shape as `AccountManagerFormDialog`. Correct as a `Dialog` rather than a
 * full page per docs/ARCHITECTURE.md "Popup vs. full page": this edits one
 * small field on a sub-entity reached from the Team tab, not a top-level
 * module record.
 */
export function EditTeamMemberNameDialog({ open, onOpenChange, member, onSaved }: EditTeamMemberNameDialogProps) {
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    if (!member) return { error: "No teammate selected." };
    const fullName = String(formData.get("fullName") ?? "");
    const result = await updateTeamMemberProfile(member.userId, { fullName });
    if (result.error || !result.data) {
      return { error: result.error ?? "Could not save this name.", fieldErrors: result.fieldErrors };
    }
    return { success: true, fullName: result.data.fullName };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && member) {
      onOpenChange(false);
      onSaved(member.userId, state.fullName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Edit name</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="edit-team-member-full-name">Full name</Label>
              <Input
                id="edit-team-member-full-name"
                name="fullName"
                defaultValue={member?.fullName ?? ""}
                required
                maxLength={200}
              />
              {state.fieldErrors?.fullName?.map((message) => (
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
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
