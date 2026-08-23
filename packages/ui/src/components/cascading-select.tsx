import { Select, type SelectProps } from "./form";

export interface CascadingSelectOption {
  id: string;
  label: string;
  /** The id of the parent-list item this option belongs under (e.g. an
   * `asset_subtype` item's `parent_item_id`, pointing at an `asset_type`
   * item). */
  parentId: string;
}

export interface CascadingSelectProps extends Omit<SelectProps, "children"> {
  /** Every possible option across every parent — this component filters
   * internally to `option.parentId === parentValue`, so callers pass the
   * full unfiltered list once rather than re-deriving the filter per form. */
  options: CascadingSelectOption[];
  /** The parent field's current selected value/id. Empty/undefined means no
   * parent is selected yet, which keeps this select empty and disabled. */
  parentValue: string | undefined;
  /** Placeholder shown once a parent IS selected but no option has been
   * chosen yet. */
  placeholder?: string;
  /** Placeholder shown (and the select left disabled) while no parent value
   * is selected yet — e.g. "Select a type first…". */
  emptyParentPlaceholder?: string;
}

/**
 * Shared "dependent reference field" pattern (docs/ARCHITECTURE.md "Domain
 * completeness"): a child `<select>` that stays empty and disabled until a
 * parent field has a value, and is filtered to only that parent's options
 * once it does — e.g. Asset Sub-type scoped by the record's own Asset Type,
 * or any future cascading picklist pair.
 *
 * Deliberately presentational only — no internal state/effects, so it needs
 * no "use client" boundary of its own (it inherits one from whatever client
 * form renders it). Re-filtering when the parent changes is automatic
 * (recomputed from props on every render); *clearing* a now-invalid child
 * selection when the parent changes is the calling form's responsibility —
 * remount this component via `key={parentValue}` on an uncontrolled
 * `defaultValue`, the same trick already used for the Site select depending
 * on the selected Client in `asset-form-dialog.tsx` (a remounted
 * uncontrolled `<select>` whose `defaultValue` no longer matches any
 * `<option>` simply falls back to the placeholder — no extra controlled
 * state needed).
 *
 * The placeholder `<option>` itself is only `disabled` when `required` is
 * set: for a *required* dependent field there's no legitimate reason to
 * submit the placeholder, so it's disabled the same way the (non-dependent)
 * Type `<Select>` disables its own "Select a type…" placeholder. For an
 * *optional* dependent field (e.g. Asset Sub-type) the placeholder must stay
 * selectable — it doubles as the explicit "no value" option, the only way a
 * caller can clear a previously-set child value once a parent is chosen
 * (same convention the Status `<Select>`'s non-disabled "Use organization
 * default" placeholder already uses in `asset-form-dialog.tsx`).
 */
export function CascadingSelect({
  options,
  parentValue,
  placeholder = "Select…",
  emptyParentPlaceholder = "Select the parent field first…",
  disabled,
  required,
  ...rest
}: CascadingSelectProps) {
  const hasParent = Boolean(parentValue);
  const filteredOptions = hasParent ? options.filter((option) => option.parentId === parentValue) : [];

  return (
    <Select disabled={disabled || !hasParent} required={required} {...rest}>
      <option value="" disabled={!hasParent || Boolean(required)}>
        {hasParent ? placeholder : emptyParentPlaceholder}
      </option>
      {filteredOptions.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
