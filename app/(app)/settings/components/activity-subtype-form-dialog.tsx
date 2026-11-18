"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createActivitySubtype,
  updateActivitySubtype,
  type ActivitySubtypeRecord,
} from "@/app/(app)/activities/subtypes-actions";
import { flattenActivitySubtypes } from "@/app/(app)/activities/subtype-tree";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DialogField, SettingsFormDialog, type DialogFormState } from "./settings-dialog-kit";

const initialState: DialogFormState = {};

export interface ActivitySubtypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  subtype?: ActivitySubtypeRecord | null;
  /** Pre-selects the Parent subtype field — set when this dialog was opened
   * via a node's own "Add subtype" action; still a changeable select. */
  parentSubtypeId?: string;
  /** The org's whole flat subtype tree, for the Parent subtype picker. */
  subtypes: ActivitySubtypeRecord[];
  /** This org's `activity_type` reference-list items, for the root-only
   * Activity Type field. */
  typeItems: ReferenceListItemRecord[];
}

/**
 * Create/edit dialog for a single `activity_subtypes` row (issues #134/#138).
 * The DB's `activity_subtypes_root_xor_parent` CHECK requires a root node
 * (no parent) to carry a `type_id` and a non-root node not to, so the
 * Activity type field only renders (and is only required) while the Parent
 * picker is set to "No parent (top-level subtype)".
 *
 * Every field is controlled and the manager mounts this only while open, so a
 * failed save keeps what was typed and a reopened dialog starts clean.
 * Cross-org parent / self-reference / cycle checks are enforced by the DB's
 * `validate_activity_subtype_parent` trigger; this dialog only excludes the
 * subtype being edited from its own Parent picker.
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

  const [name, setName] = useState(subtype?.name ?? "");
  const [parentValue, setParentValue] = useState(subtype?.parent_subtype_id ?? parentSubtypeId ?? "");
  const [typeId, setTypeId] = useState(subtype?.type_id ?? "");

  const isRoot = parentValue === "";

  const parentOptions = useMemo(() => {
    const flattened = flattenActivitySubtypes(subtypes);
    return subtype ? flattened.filter((item) => item.id !== subtype.id) : flattened;
  }, [subtypes, subtype]);

  async function action(): Promise<DialogFormState> {
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
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit subtype" : "Add subtype"}
      submitLabel={isEdit ? "Save changes" : "Add subtype"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="activity-subtype-name" label="Name" errors={state.fieldErrors?.name}>
        <input
          id="activity-subtype-name"
          className="web-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
        />
      </DialogField>

      <DialogField id="parentSubtypeId" label="Parent subtype" errors={state.fieldErrors?.parentSubtypeId}>
        <select
          id="parentSubtypeId"
          className="web-select"
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
        </select>
      </DialogField>

      {isRoot && (
        <DialogField id="activity-subtype-type" label="Activity type" errors={state.fieldErrors?.typeId}>
          <select
            id="activity-subtype-type"
            className="web-select"
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
          </select>
        </DialogField>
      )}
    </SettingsFormDialog>
  );
}
