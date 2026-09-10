"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Input, Label, Select, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import {
  createSolutionSubtype,
  updateSolutionSubtype,
  type SolutionSubtypeRecord,
} from "@/app/(app)/activities/solution-subtype-actions";
import { flattenSolutionSubtypes } from "@/app/(app)/activities/solution-subtype-tree";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface SolutionSubtypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create — same `isEdit = Boolean(subtype)`
   * convention as `ArticleGroupFormDialog`. */
  subtype?: SolutionSubtypeRecord | null;
  /** Pre-selects the Parent subtype field — set when this dialog was opened
   * via a node's own "Add subtype" action; still a plain, changeable
   * `<Select>` field, not locked, since the user may want a different parent
   * than the one they clicked from. */
  parentSubtypeId?: string;
  /** The org's whole flat subtype tree, for the Parent subtype picker. */
  subtypes: SolutionSubtypeRecord[];
}

/**
 * Create/edit dialog for a single `solution_subtypes` row (issues #134/#138)
 * — a small, secondary sub-entity dialog reached from the Solution Subtypes
 * settings tab — exactly the "Contacts/Sites on a client"-weight case
 * docs/ARCHITECTURE.md's "Popup vs. full page" section carves out for a
 * plain `Dialog`, not a full page: Solution Subtypes aren't a top-level
 * module record, they're configuration data for the Activities module.
 *
 * No Type field ever, at any depth (unlike its sibling
 * `ActivitySubtypeFormDialog`). Cross-org parent / self-reference / cycle
 * checks are entirely enforced by the DB's `validate_solution_subtype_parent`
 * trigger — this dialog only excludes the subtype being edited from its own
 * Parent picker (an obviously-invalid self-parent), and otherwise just
 * surfaces whatever error text a rejected submission comes back with.
 *
 * Every field is CONTROLLED (issue #136-class bugfix, same one already
 * applied to `reference-item-form-dialog.tsx`/`ActivitySubtypeFormDialog`):
 * a plain uncontrolled (`defaultValue`-only) field gets reset by React's own
 * `useActionState`/`<form action>` machinery after EVERY submission, success
 * or failure — a failed save used to wipe the whole form back to blank the
 * instant the error appeared. `SolutionSubtypeManager` also now only mounts
 * this component while `formState.open` is true (was previously
 * always-mounted, just toggling an `open` prop) — staying mounted meant
 * `useActionState`'s own state never reset between sessions, so reopening
 * this dialog for a brand new subtype could still show a stale error from an
 * unrelated previous attempt.
 */
export function SolutionSubtypeFormDialog({
  open,
  onOpenChange,
  subtype,
  parentSubtypeId,
  subtypes,
}: SolutionSubtypeFormDialogProps) {
  const isEdit = Boolean(subtype);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const [name, setName] = useState(subtype?.name ?? "");
  const [parentValue, setParentValue] = useState(subtype?.parent_subtype_id ?? parentSubtypeId ?? "");

  const parentOptions = useMemo(() => {
    const flattened = flattenSolutionSubtypes(subtypes);
    // A subtype can't be its own parent — the DB trigger would reject a
    // self-reference regardless, this just keeps the picker from offering an
    // option that always fails. Deeper cycles (picking one of this subtype's
    // OWN descendants) aren't filtered out here — surfaced via the trigger's
    // rejection message instead, per this task's own scope note.
    return subtype ? flattened.filter((item) => item.id !== subtype.id) : flattened;
  }, [subtypes, subtype]);

  async function action(): Promise<FormState> {
    const input = {
      name,
      parentSubtypeId: parentValue || undefined,
    };
    const result = isEdit ? await updateSolutionSubtype(subtype!.id, input) : await createSolutionSubtype(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit subtype" : "Add subtype"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="solution-subtype-name">Name</Label>
              <Input
                id="solution-subtype-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />
              {state.fieldErrors?.name?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="solution-subtype-parent">Parent subtype</Label>
              <Select
                id="solution-subtype-parent"
                value={parentValue}
                onChange={(event) => setParentValue(event.target.value)}
              >
                <option value="">No parent (top-level subtype)</option>
                {parentOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {"— ".repeat(item.depth)}
                    {item.name}
                  </option>
                ))}
              </Select>
              {state.fieldErrors?.parentSubtypeId?.map((message) => (
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
          <SubmitButton isEdit={isEdit} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add subtype"}
    </Button>
  );
}
