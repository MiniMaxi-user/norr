"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Input, Label, Select, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import {
  createActivitySubtype,
  updateActivitySubtype,
  type ActivitySubtypeRecord,
} from "@/app/(app)/activities/subtypes-actions";
import { flattenActivitySubtypes } from "@/app/(app)/activities/subtype-tree";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ActivitySubtypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create — same `isEdit = Boolean(subtype)`
   * convention as `ArticleGroupFormDialog`. */
  subtype?: ActivitySubtypeRecord | null;
  /** Pre-selects the Parent subtype field — set when this dialog was opened
   * via a node's own "Add subtype" action; still a plain, changeable
   * `<Select>` field, not locked, since the user may want a different parent
   * than the one they clicked from. */
  parentSubtypeId?: string;
  /** The org's whole flat subtype tree, for the Parent subtype picker. */
  subtypes: ActivitySubtypeRecord[];
  /** This org's `activity_type` reference-list items, for the root-only
   * Activity Type field below. */
  typeItems: ReferenceListItemRecord[];
}

/**
 * Create/edit dialog for a single `activity_subtypes` row (issues #134/#138)
 * — with one real twist: the DB's `activity_subtypes_root_xor_parent` CHECK
 * requires a root node (`parent_subtype_id is null`) to carry a `type_id`,
 * and a non-root node to NOT carry one. The form reflects that rule directly
 * rather than only failing server-side: the Activity Type field only renders
 * (and is only required) while the Parent picker is set to "No parent
 * (top-level)".
 *
 * Every field is CONTROLLED (issue #136-class bugfix, same one already
 * applied to `reference-item-form-dialog.tsx`): a plain uncontrolled
 * (`defaultValue`-only) field gets reset by React's own `useActionState`/
 * `<form action>` machinery after EVERY submission, success or failure — a
 * failed save (e.g. a duplicate `value`, or this table's own root-xor-parent
 * rejection) used to wipe the whole form back to blank the instant the error
 * appeared. `ActivitySubtypeManager` also now only mounts this component
 * while `formState.open` is true (was previously always-mounted, just
 * toggling an `open` prop) — every OTHER dialog in this codebase already
 * conditionally renders; staying mounted meant `useActionState`'s own state
 * (error text, the `success` flag) never reset between sessions, so
 * reopening this dialog for a brand new subtype could still show a stale
 * error from an unrelated previous attempt. Together: every field's
 * `useState` initializer reads straight from `subtype` — safe with no
 * re-seed effect needed, since a fresh mount happens on every open.
 *
 * Cross-org parent / self-reference / cycle / root-type-link checks are all
 * enforced by the DB's `validate_activity_subtype_parent` trigger (see
 * `subtypes-actions.ts`'s own doc comment) — this dialog only excludes the
 * subtype being edited from its own Parent picker (an obviously-invalid
 * self-parent) and hides/shows the Type field; everything else is surfaced
 * via whatever error text a rejected submission comes back with.
 */
export function ActivitySubtypeFormDialog({
  open,
  onOpenChange,
  subtype,
  parentSubtypeId,
  subtypes,
  typeItems,
}: ActivitySubtypeFormDialogProps) {
  const isEdit = Boolean(subtype);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const [name, setName] = useState(subtype?.name ?? "");
  const [parentValue, setParentValue] = useState(subtype?.parent_subtype_id ?? parentSubtypeId ?? "");
  const [typeId, setTypeId] = useState(subtype?.type_id ?? "");

  const isRoot = parentValue === "";

  const parentOptions = useMemo(() => {
    const flattened = flattenActivitySubtypes(subtypes);
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
      typeId: isRoot ? typeId || undefined : undefined,
    };
    const result = isEdit ? await updateActivitySubtype(subtype!.id, input) : await createActivitySubtype(input);
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
              <Label htmlFor="activity-subtype-name">Name</Label>
              <Input
                id="activity-subtype-name"
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
              <Label htmlFor="parentSubtypeId">Parent subtype</Label>
              <Select
                id="parentSubtypeId"
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

            {isRoot && (
              <Stack gap="xs">
                <Label htmlFor="activity-subtype-type">Activity type</Label>
                <Select
                  id="activity-subtype-type"
                  value={typeId}
                  onChange={(event) => setTypeId(event.target.value)}
                  required
                >
                  <option value="">Select an activity type…</option>
                  {typeItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.typeId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            )}
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
