"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSolutionSubtype,
  updateSolutionSubtype,
  type SolutionSubtypeRecord,
} from "@/app/(app)/activities/solution-subtype-actions";
import { flattenSolutionSubtypes } from "@/app/(app)/activities/solution-subtype-tree";
import { DialogField, SettingsFormDialog, type DialogFormState } from "./settings-dialog-kit";

const initialState: DialogFormState = {};

export interface SolutionSubtypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  subtype?: SolutionSubtypeRecord | null;
  /** Pre-selects the Parent subtype field — set when this dialog was opened
   * via a node's own "Add subtype" action; still a changeable select. */
  parentSubtypeId?: string;
  /** The org's whole flat subtype tree, for the Parent subtype picker. */
  subtypes: SolutionSubtypeRecord[];
}

/**
 * Create/edit dialog for a single `solution_subtypes` row (issues #134/#138)
 * — a small sub-entity dialog reached from the Solution subtypes settings
 * page. No Type field at any depth (unlike `ActivitySubtypeFormDialog`).
 * Cross-org parent / self-reference / cycle checks are enforced by the DB's
 * `validate_solution_subtype_parent` trigger; this dialog only excludes the
 * subtype being edited from its own Parent picker.
 *
 * Every field is controlled and the manager mounts this only while open, so a
 * failed save keeps what was typed and a reopened dialog starts clean.
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

  const [name, setName] = useState(subtype?.name ?? "");
  const [parentValue, setParentValue] = useState(subtype?.parent_subtype_id ?? parentSubtypeId ?? "");

  const parentOptions = useMemo(() => {
    const flattened = flattenSolutionSubtypes(subtypes);
    return subtype ? flattened.filter((item) => item.id !== subtype.id) : flattened;
  }, [subtypes, subtype]);

  async function action(): Promise<DialogFormState> {
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
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit subtype" : "Add subtype"}
      submitLabel={isEdit ? "Save changes" : "Add subtype"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="solution-subtype-name" label="Name" errors={state.fieldErrors?.name}>
        <input
          id="solution-subtype-name"
          className="web-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
        />
      </DialogField>

      <DialogField id="solution-subtype-parent" label="Parent subtype" errors={state.fieldErrors?.parentSubtypeId}>
        <select
          id="solution-subtype-parent"
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
    </SettingsFormDialog>
  );
}
