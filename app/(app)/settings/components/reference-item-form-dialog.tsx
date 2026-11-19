"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusText, toneFromColor } from "@yourorg/ui/web-client";
import {
  createReferenceItem,
  updateReferenceItem,
  type ReferenceListItemRecord,
} from "@/lib/reference-lists/actions";
import { REFERENCE_ITEM_COLOR_PALETTE } from "@/lib/reference-lists/schema";
import { DialogField, SettingsFormDialog } from "./settings-dialog-kit";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ReferenceItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listKey: string;
  /** Present for edit, absent for create — same `isEdit = Boolean(item)`
   * convention as `ClientFormDialog`/`SiteFormDialog`. */
  item?: ReferenceListItemRecord | null;
  /** Non-null exactly when `listKey`'s own list is a *dependent* list (e.g.
   * `asset_subtype` -> `"asset_type"`, see `reference_lists.parent_list_key`
   * in the contacts/dependent-lists migration). When set, a parent-item
   * picker is shown and required — `createReferenceItem`/`updateReferenceItem`
   * reject a missing `parentItemId` on such a list. */
  parentListKey: string | null;
  /** Display title for `parentListKey` (e.g. `"Asset Type"`), used only for
   * the picker's label/placeholder copy. */
  parentListTitle?: string;
  /** Every item of the parent list, to populate the picker. Empty when
   * `parentListKey` is `null`. */
  parentItems: ReferenceListItemRecord[];
  /** Shows the "Default duration (minutes)" field (issue #165) — mirrors
   * `ReferenceListManager`'s own prop of the same name, threaded straight
   * through. Defaults to `false`. */
  showDefaultDuration?: boolean;
  /** Shows the "Invoice interval (months)" field (issue #209) — `billing_terms` only. */
  showInvoiceInterval?: boolean;
  /** Shows the "Default in planning" checkbox (issue #222) — `activity_type` only. */
  showPlanningDefault?: boolean;
}

/**
 * Create/edit dialog for a single value within a tenant-configurable
 * reference list (Asset Type/Status/Sub-type, Contact Role today). Generic
 * over `listKey` — reused by `ReferenceListManager` for every list rather
 * than one dialog per list. Extended (issue #26) with an optional
 * parent-item picker for *dependent* lists (`parentListKey` non-null) — see
 * `lib/reference-lists/actions.ts`'s `validateDependentParentItem`, which
 * this dialog mirrors at the form layer: required exactly when the list is
 * dependent, absent otherwise.
 *
 * Two related fixes for issue #136 ("Values" — saving felt unreliable: the
 * popup sometimes didn't close, a just-added value didn't show up, and a
 * failed validation wiped every typed field):
 *
 * 1. **Every field is a CONTROLLED input.** React's own `useActionState`/
 *    `<form action>` machinery resets every UNCONTROLLED (`defaultValue`-only)
 *    field back to its original value after EVERY submission, success or
 *    failure. With `label`/`value`/`description`/`isActive` all uncontrolled,
 *    a failed validation attempt (e.g. a duplicate `value`) reset the whole
 *    form back to blank the instant the error appeared — the user's typed
 *    data visibly vanished alongside the red error text, even though nothing
 *    was actually lost server-side. Controlled fields (`value={state}
 *    onChange={...}`, same pattern `color` already used) are immune to that
 *    native reset: React keeps rendering whatever the component's own state
 *    says, regardless of what the browser's form-reset tried to do. Every
 *    field's `useState` initializer reads straight from `item` — safe (no
 *    re-seed effect needed) specifically BECAUSE of fix 2 below.
 * 2. **`ReferenceListManager` now only mounts this component while
 *    `formState.open` is true**, matching how every OTHER dialog in this
 *    codebase is conditionally rendered (e.g. `{relationsOpen && (<...Dialog
 *    open .../>)}`) — this one used to be the exception, always mounted with
 *    `open={formState.open}` toggling a prop instead. Staying mounted across
 *    every open/close cycle meant `useActionState`'s own internal `state`
 *    (error text, field errors, the `success` flag the effect below watches)
 *    NEVER reset between sessions — reopening this dialog for a brand new
 *    value could still be showing a stale error/fieldErrors from a
 *    completely unrelated PREVIOUS failed attempt, which is exactly the kind
 *    of confusing "feels stuck / doesn't close / doesn't reflect what I just
 *    did" behavior the issue described. A fresh mount on every open gives a
 *    fresh `useActionState` (back to `initialState`) and fresh field state
 *    for free, with zero manual reset code.
 */
export function ReferenceItemFormDialog({
  open,
  onOpenChange,
  listKey,
  item,
  parentListKey,
  parentListTitle,
  parentItems,
  showDefaultDuration = false,
  showInvoiceInterval = false,
  showPlanningDefault = false,
}: ReferenceItemFormDialogProps) {
  const isEdit = Boolean(item);
  const isDependent = Boolean(parentListKey);
  const router = useRouter();
  const [label, setLabel] = useState(item?.label ?? "");
  const [value, setValue] = useState(item?.value ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [color, setColor] = useState(item?.color ?? "");
  const [isActive, setIsActive] = useState(item ? item.is_active : true);
  const [parentItemId, setParentItemId] = useState(item?.parent_item_id ?? "");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    item?.default_duration_minutes != null ? String(item.default_duration_minutes) : "",
  );
  const [planningDefault, setPlanningDefault] = useState(item?.planning_default ?? false);
  const [intervalMonths, setIntervalMonths] = useState(
    item?.interval_months != null ? String(item.interval_months) : "",
  );

  async function action(): Promise<FormState> {
    const input = {
      value,
      label,
      description: description || undefined,
      color: color || undefined,
      parentItemId: isDependent ? parentItemId || undefined : undefined,
      isActive,
      defaultDurationMinutes: showDefaultDuration ? defaultDurationMinutes || undefined : undefined,
      // "" (not undefined) so an edit clears a previously-set interval.
      intervalMonths: showInvoiceInterval ? intervalMonths : undefined,
      planningDefault: showPlanningDefault ? planningDefault : undefined,
    };
    const result = isEdit ? await updateReferenceItem(item!.id, input) : await createReferenceItem(listKey, input);
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

  const parentName = (parentListTitle ?? "parent").toLowerCase();

  return (
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit value" : "Add value"}
      submitLabel={isEdit ? "Save changes" : "Add value"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="ref-item-label" label="Label" errors={state.fieldErrors?.label}>
        <input
          id="ref-item-label"
          className="web-input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          maxLength={200}
        />
      </DialogField>

      <DialogField id="ref-item-description" label="Description" errors={state.fieldErrors?.description}>
        <textarea
          id="ref-item-description"
          className="web-textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          rows={3}
        />
      </DialogField>

      {isDependent && (
        <DialogField
          id="ref-item-parent"
          label={parentListTitle ?? "Parent"}
          hint={`Every value on this list belongs under one ${parentName} value.`}
          errors={[
            ...(state.fieldErrors?.parentItemId ?? []),
            ...(parentItems.length === 0 ? [`No ${parentName} values exist yet — add one there first.`] : []),
          ]}
        >
          <select
            id="ref-item-parent"
            className="web-select"
            value={parentItemId}
            onChange={(event) => setParentItemId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a {parentName}…
            </option>
            {parentItems.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </DialogField>
      )}

      <DialogField
        id="ref-item-value"
        label="Value (stable id)"
        hint="Lowercase letters, numbers, and underscores only. Not shown anywhere — only the Label is user-facing."
        errors={state.fieldErrors?.value}
      >
        <input
          id="ref-item-value"
          className="web-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          maxLength={100}
          placeholder="e.g. hvac"
        />
      </DialogField>

      <DialogField
        id="ref-item-color"
        label="Color"
        hint={`One of: ${REFERENCE_ITEM_COLOR_PALETTE.join(", ")} — or a hex code (e.g. #22c55e). Leave blank for no color.`}
        errors={state.fieldErrors?.color}
      >
        <input
          id="ref-item-color"
          className="web-input"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          placeholder="blue, green, #22c55e…"
          maxLength={20}
        />
        {color ? (
          <p className="web-rail-empty">
            Preview: <StatusText tone={toneFromColor(color)}>{label || "Preview"}</StatusText>
          </p>
        ) : null}
      </DialogField>

      {showDefaultDuration && (
        <DialogField
          id="ref-item-default-duration"
          label="Default duration (minutes)"
          hint="Optional. Used later to size work items for this type in Planning."
          errors={state.fieldErrors?.defaultDurationMinutes}
        >
          <input
            id="ref-item-default-duration"
            className="web-input"
            type="number"
            data-numeric="true"
            min={0}
            step={1}
            value={defaultDurationMinutes}
            onChange={(event) => setDefaultDurationMinutes(event.target.value)}
            placeholder="e.g. 60"
          />
        </DialogField>
      )}

      {showInvoiceInterval && (
        <DialogField
          id="ref-item-interval-months"
          label="Invoice interval (months)"
          hint="Leave empty for non-recurring terms such as per-visit or one-time."
          errors={state.fieldErrors?.intervalMonths}
        >
          <input
            id="ref-item-interval-months"
            className="web-input"
            type="number"
            data-numeric="true"
            min={1}
            step={1}
            value={intervalMonths}
            onChange={(event) => setIntervalMonths(event.target.value)}
            placeholder="e.g. 3"
          />
        </DialogField>
      )}

      {showPlanningDefault && (
        <label className="web-field-checkbox" htmlFor="ref-item-planning-default">
          <input
            id="ref-item-planning-default"
            type="checkbox"
            checked={planningDefault}
            onChange={(event) => setPlanningDefault(event.target.checked)}
          />
          Default in planning
        </label>
      )}

      <label className="web-field-checkbox" htmlFor="ref-item-is-active">
        <input
          id="ref-item-is-active"
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        Active
      </label>
    </SettingsFormDialog>
  );
}
