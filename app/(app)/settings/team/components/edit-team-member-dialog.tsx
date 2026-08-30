"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, Dialog, Heading, Input, Label, Separator, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { updateTeamMemberProfile, updateTeamMemberRateSettings, type TeamMemberRecord } from "@/lib/team/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { RateSettingsSection } from "@/lib/rate-overrides/rate-settings-section";
import type { RateOverrideRecord } from "@/lib/rate-overrides/schema";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  fullName?: string;
  rateSettings?: RateOverrideRecord;
}

const initialState: FormState = {};

export interface EditTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberRecord | null;
  /** `listArticlesForSelect()`'s result, fetched once by `team-board.tsx` and
   * threaded down — only actually consumed when `member.role === "engineer"`
   * (see this component's own doc comment), but fetched unconditionally same
   * as `accountManagers` is for the Clients module, so it's ready the moment
   * any engineer row is opened. */
  articles: ArticleSelectOption[];
  /** Called once every save this dialog performed succeeds, with the fields
   * `TeamManager` needs to patch its local member list without a full
   * `router.refresh()`. `rateSettings` is always the member's current (saved)
   * settings — unchanged from `member.rateSettings` for a non-engineer row,
   * which never renders (or submits) the rate section at all. */
  onSaved: (userId: string, fullName: string, rateSettings: RateOverrideRecord) => void;
}

/**
 * Edit a teammate's own profile — display name, plus (issue #93, "Reistijd
 * en werktijd artikelen beheren") a "Custom rate" section, ONLY for a
 * teammate whose role is `engineer` (an "engineer" IS a `memberships` row
 * with `role = 'engineer'` — see `lib/rate-overrides/schema.ts`'s header
 * comment; no separate `engineers` table). Grown out of what used to be
 * `EditTeamMemberNameDialog` (name-only) rather than added as a second
 * dialog, per this issue's own instruction to keep team management in one
 * place instead of fragmenting it across two popups for the same row.
 *
 * Still correctly a `Dialog`, not a full page, per docs/ARCHITECTURE.md
 * "Popup vs. full page": that rule's "top-level module entity gets a real
 * page" default is about Clients/Assets/Contracts/Planning/future Quotes —
 * a team member row is a sub-entity of the Team settings screen (reached
 * from a table row, same weight class as Contacts/Sites on a client), not a
 * top-level module of its own. Bumped from `size="sm"` to `size="lg"` (was
 * a single name field before) now that an engineer row can also carry the
 * checkbox + two article pickers + two editable/two read-only price fields.
 *
 * Both saves run sequentially from ONE submit — same "one form, multiple
 * sequential Server Action calls" shape `NewClientPanel` already establishes
 * for `createClient` then `createSite` — rather than a nested mini-form
 * inside the rate section. `updateTeamMemberProfile` always runs first (name
 * is never conditional); `updateTeamMemberRateSettings` only runs for an
 * `engineer` row. If the name save succeeds but the rate save then fails,
 * the dialog stays open showing the rate error (same partial-failure
 * tolerance `NewClientPanel` documents for its own two-call submit) — the
 * name change already persisted, and resubmitting simply re-saves the same
 * name again (harmless) before retrying the rate save.
 */
export function EditTeamMemberDialog({ open, onOpenChange, member, articles, onSaved }: EditTeamMemberDialogProps) {
  useEscapeToClose(open, onOpenChange);
  const isEngineer = member?.role === "engineer";

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    if (!member) return { error: "No teammate selected." };

    const fullName = String(formData.get("fullName") ?? "");
    const profileResult = await updateTeamMemberProfile(member.userId, { fullName });
    if (profileResult.error || !profileResult.data) {
      return { error: profileResult.error ?? "Could not save this name.", fieldErrors: profileResult.fieldErrors };
    }

    if (!isEngineer) {
      return { success: true, fullName: profileResult.data.fullName, rateSettings: member.rateSettings };
    }

    // A `<Checkbox>` only appears in `FormData` at all when checked — see
    // `RateSettingsSection`'s own doc comment.
    const rateInput = {
      ...Object.fromEntries(formData.entries()),
      hasCustomRate: formData.get("hasCustomRate") === "on",
    };
    const rateResult = await updateTeamMemberRateSettings(member.userId, rateInput);
    if (rateResult.error || !rateResult.data) {
      return {
        error: rateResult.error ?? "Could not save rate settings.",
        fieldErrors: rateResult.fieldErrors,
        fullName: profileResult.data.fullName,
      };
    }

    return { success: true, fullName: profileResult.data.fullName, rateSettings: rateResult.data };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && member) {
      onOpenChange(false);
      onSaved(member.userId, state.fullName ?? "", state.rateSettings ?? member.rateSettings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
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

            {isEngineer && member && (
              <>
                <Separator />
                <RateSettingsSection
                  idPrefix="engineer-rate"
                  initial={member.rateSettings}
                  articles={articles}
                  subjectLabel="engineer"
                  errors={{
                    travelArticleId: state.fieldErrors?.travelArticleId,
                    workArticleId: state.fieldErrors?.workArticleId,
                    travelSalePrice: state.fieldErrors?.travelSalePrice,
                    workSalePrice: state.fieldErrors?.workSalePrice,
                  }}
                />
              </>
            )}
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
