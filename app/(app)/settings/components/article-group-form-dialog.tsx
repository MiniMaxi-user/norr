"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormField, FormSelectField, Heading, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { createArticleGroup, updateArticleGroup, type ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { flattenArticleGroups } from "@/app/(app)/articles/group-tree";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ArticleGroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create — same `isEdit = Boolean(group)`
   * convention as `AssetModelFormDialog`. */
  group?: ArticleGroupRecord | null;
  /** Pre-selects the Parent group field — set when this dialog was opened
   * via a node's own "Add subgroup" action; still a plain, changeable
   * `<Select>` field, not locked, since the user may want a different parent
   * than the one they clicked from. */
  parentGroupId?: string;
  /** The org's whole flat group tree, for the Parent group picker. */
  groups: ArticleGroupRecord[];
}

/**
 * Create/edit dialog for a single `article_groups` row (issue #92). A small,
 * secondary sub-entity dialog reached from the Article Groups settings tab —
 * exactly the "Contacts/Sites on a client"-weight case docs/ARCHITECTURE.md's
 * "Popup vs. full page" section carves out for a plain `Dialog`, not a full
 * page: Article Groups aren't a top-level module record, they're
 * configuration data for the Articles catalog.
 *
 * Cross-org parent / self-reference / cycle checks are entirely enforced by
 * the DB's `validate_article_group_parent` trigger (see `groups-actions.ts`'s
 * own doc comment) — this dialog only excludes the group being edited from
 * its own Parent picker (an obviously-invalid self-parent), and otherwise
 * just surfaces whatever error text a rejected submission comes back with.
 */
export function ArticleGroupFormDialog({ open, onOpenChange, group, parentGroupId, groups }: ArticleGroupFormDialogProps) {
  const isEdit = Boolean(group);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const parentOptions = useMemo(() => {
    const flattened = flattenArticleGroups(groups);
    // A group can't be its own parent — the DB trigger would reject a
    // self-reference regardless, this just keeps the picker from offering an
    // option that always fails. Deeper cycles (picking one of this group's
    // OWN descendants) aren't filtered out here — surfaced via the trigger's
    // rejection message instead, per this task's own scope note.
    return group ? flattened.filter((item) => item.id !== group.id) : flattened;
  }, [groups, group]);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      name: formData.get("name"),
      parentGroupId: formData.get("parentGroupId") || undefined,
    };
    const result = isEdit ? await updateArticleGroup(group!.id, input) : await createArticleGroup(input);
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
        <Heading level={3}>{isEdit ? "Edit group" : "Add group"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormField
              label="Name"
              name="name"
              defaultValue={group?.name}
              required
              maxLength={200}
              errors={state.fieldErrors?.name}
            />

            <FormSelectField
              label="Parent group"
              name="parentGroupId"
              defaultValue={group?.parent_group_id ?? parentGroupId ?? ""}
              errors={state.fieldErrors?.parentGroupId}
            >
              <option value="">No parent (top-level group)</option>
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add group"}
    </Button>
  );
}
