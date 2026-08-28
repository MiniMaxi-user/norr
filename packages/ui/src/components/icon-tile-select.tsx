import type { ReactNode } from "react";
import { cx } from "../cx";

export interface IconTileOption {
  value: string;
  label: string;
  /** Rendered at ~1.5rem via the tile's own icon slot — pass an
   * `@yourorg/ui/icons` component instance (e.g. `<Phone />`). */
  icon: ReactNode;
}

export interface IconTileSelectProps {
  /** Every selectable option, rendered left-to-right/wrapping — same "caller
   * passes the full list, component just renders it" contract as
   * `CascadingSelect`/`Combobox`. */
  options: IconTileOption[];
  /** Selected option's `value`. `""`/`undefined` means no selection. */
  value?: string;
  onChange: (value: string) => void;
  /** Mirrors `value` into a same-named `<input type="hidden">` so this works
   * as a real named form control inside a plain `<form action={...}>` —
   * same convention `Combobox`'s own `name` prop follows. */
  name?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Icon-based single-select — a row of tiles (icon + label) instead of a
 * dropdown, for a small, fixed set of visually-distinct options someone picks
 * by recognition rather than by reading a list (e.g. Activity Type: Bel
 * activiteit/Storing/Onderhoud/Afspraak/E-mail opvolging, each carrying a
 * `reference_list_items.icon`). Deliberately presentational only — no
 * internal state, same as `CascadingSelect` — so it needs no "use client"
 * boundary of its own; it inherits one from whatever client form renders it.
 *
 * Built as a real `role="radiogroup"` of `role="radio"` buttons (not native
 * `<input type="radio">`s, since the visual tile needs a `<button>`'s free
 * layout) — keyboard use still works via each tile's own native button
 * focus/Enter/Space activation; a caller after full roving-tabindex arrow-key
 * navigation between tiles can extend this later if that specific gap turns
 * out to matter, same "ship the common case, extend on demand" stance
 * `Combobox`'s own doc comment takes with click-outside handling.
 */
export function IconTileSelect({
  options,
  value,
  onChange,
  name,
  disabled,
  className,
  "aria-label": ariaLabel,
}: IconTileSelectProps) {
  return (
    <div className={cx("ui-icon-tile-group", className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={cx("ui-icon-tile", selected && "ui-icon-tile-selected")}
            onClick={() => onChange(option.value)}
          >
            <span className="ui-icon-tile-icon" aria-hidden="true">
              {option.icon}
            </span>
            <span className="ui-icon-tile-label">{option.label}</span>
          </button>
        );
      })}
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
    </div>
  );
}
