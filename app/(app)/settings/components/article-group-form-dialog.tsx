"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createArticleGroup, updateArticleGroup, type ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { flattenArticleGroups } from "@/app/(app)/articles/group-tree";
import { DialogField, SettingsFormDialog, type DialogFormState } from "./settings-dialog-kit";

const initialState: DialogFormState = {};

export interface ArticleGroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  group?: ArticleGroupRecord | null;
  /** Pre-selects the Parent group field — set when this dialog was opened
   * via a node's own "Add subgroup" action; still a changeable select. */
  parentGroupId?: string;
  /** The org's whole flat group tree, for the Parent group picker. */
  groups: ArticleGroupRecord[];
}

/**
 * Create/edit dialog for a single `article_groups` row (issue #92) — a small
 * sub-entity dialog reached from the Article groups settings page.
 *
 * Cross-org parent / self-reference / cycle checks are enforced by the DB's
 * `validate_article_group_parent` trigger (see `groups-actions.ts`) — this
 * dialog only excludes the group being edited from its own Parent picker and
 * surfaces whatever error a rejected submission comes back with.
 */
export function ArticleGroupFormDialog({ open, onOpenChange, group, parentGroupId, groups }: ArticleGroupFormDialogProps) {
  const isEdit = Boolean(group);
  const router = useRouter();

  const parentOptions = useMemo(() => {
    const flattened = flattenArticleGroups(groups);
    return group ? flattened.filter((item) => item.id !== group.id) : flattened;
  }, [groups, group]);

  async function action(_prevState: DialogFormState, formData: FormData): Promise<DialogFormState> {
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
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit group" : "Add group"}
      submitLabel={isEdit ? "Save changes" : "Add group"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="article-group-name" label="Name" errors={state.fieldErrors?.name}>
        <input
          id="article-group-name"
          className="web-input"
          name="name"
          defaultValue={group?.name}
          required
          maxLength={200}
        />
      </DialogField>

      <DialogField id="article-group-parent" label="Parent group" errors={state.fieldErrors?.parentGroupId}>
        <select
          id="article-group-parent"
          className="web-select"
          name="parentGroupId"
          defaultValue={group?.parent_group_id ?? parentGroupId ?? ""}
        >
          <option value="">No parent (top-level group)</option>
          {parentOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {"— ".repeat(item.depth)}
              {item.name}
            </option>
          ))}
        </select>
      </DialogField>
    </SettingsFormDialog>
  );
}
