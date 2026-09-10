"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormField, FormSelectField, Heading, Stack, Text, useEscapeToClose } from "@yourorg/ui";
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
 * — a direct mirror of `ArticleGroupFormDialog`, just swapped
 * `ArticleGroup`→`SolutionSubtype`, `group`→`subtype`,
 * `parentGroupId`→`parentSubtypeId`. A small, secondary sub-entity dialog
 * reached from the Solution Subtypes settings tab — exactly the
 * "Contacts/Sites on a client"-weight case docs/ARCHITECTURE.md's "Popup vs.
 * full page" section carves out for a plain `Dialog`, not a full page:
 * Solution Subtypes aren't a top-level module record, they're configuration
 * data for the Activities module.
 *
 * Zero twist here (unlike its sibling `ActivitySubtypeFormDialog`) — no
 * Type field ever, at any depth. Cross-org parent / self-reference / cycle
 * checks are entirely enforced by the DB's `validate_solution_subtype_parent`
 * trigger — this dialog only excludes the subtype being edited from its own
 * Parent picker (an obviously-invalid self-parent), and otherwise just
 * surfaces whatever error text a rejected submission comes back with.
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

  const parentOptions = useMemo(() => {
    const flattened = flattenSolutionSubtypes(subtypes);
    // A subtype can't be its own parent — the DB trigger would reject a
    // self-reference regardless, this just keeps the picker from offering an
    // option that always fails. Deeper cycles (picking one of this subtype's
    // OWN descendants) aren't filtered out here — surfaced via the trigger's
    // rejection message instead, per this task's own scope note.
    return subtype ? flattened.filter((item) => item.id !== subtype.id) : flattened;
  }, [subtypes, subtype]);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      name: formData.get("name"),
      parentSubtypeId: formData.get("parentSubtypeId") || undefined,
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

            <FormField
              label="Name"
              name="name"
              defaultValue={subtype?.name}
              required
              maxLength={200}
              errors={state.fieldErrors?.name}
            />

            <FormSelectField
              label="Parent subtype"
              name="parentSubtypeId"
              defaultValue={subtype?.parent_subtype_id ?? parentSubtypeId ?? ""}
              errors={state.fieldErrors?.parentSubtypeId}
            >
              <option value="">No parent (top-level subtype)</option>
              {parentOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {"— ".repeat(item.depth)}
                  {item.name}
                </option>
              ))}
            </FormSelectField>
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
