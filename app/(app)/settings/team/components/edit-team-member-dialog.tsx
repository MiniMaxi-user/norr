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

export interface EditTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberRecord | null;
  /** Called once the save succeeds, with the member's fresh (saved) name, so
   * `TeamManager` can patch its local member list without a full
   * `router.refresh()`. */
  onSaved: (userId: string, fullName: string) => void;
}

/**
 * Edit a teammate's display name. Trimmed down (issue #192) from what used
 * to also carry a "Custom rate" section (issue #93) and a "Region" `<Select>`
 * (issue #164) — both moved onto the new `/settings/team/[userId]` detail
 * page (`RateOverridesSection`/`DefaultServiceAreaSection`, plus the new
 * `ServiceAreasSection`), which is where region-linking specifically needed
 * to live per this story ("op de monteur details pagina"). Each field now
 * has exactly one home: name stays a quick single-field popup edit, rate
 * overrides/Service Areas are detail-page-only — no field is editable from
 * both places.
 *
 * Still correctly a `Dialog`, not a full page, per docs/ARCHITECTURE.md
 * "Popup vs. full page": a single quick-edit text field on a sub-entity row
 * (reached from the Team table) is exactly the "small, secondary" case that
 * stays a popup — the detail page exists for the sections that actually
 * needed page-level room, not for this one.
 */
export function EditTeamMemberDialog({ open, onOpenChange, member, onSaved }: EditTeamMemberDialogProps) {
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    if (!member) return { error: "No teammate selected." };

    const fullName = String(formData.get("fullName") ?? "");
    const profileResult = await updateTeamMemberProfile(member.userId, { fullName });
    if (profileResult.error || !profileResult.data) {
      return { error: profileResult.error ?? "Could not save this name.", fieldErrors: profileResult.fieldErrors };
    }

    return { success: true, fullName: profileResult.data.fullName };
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
        <Heading level={3}>Edit teammate</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
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
