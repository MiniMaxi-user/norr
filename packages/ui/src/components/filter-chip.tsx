import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { X } from "../icons";

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Filter name, e.g. "Client". */
  label: string;
  /** Selected value, e.g. "Fjordline AS". */
  children: ReactNode;
  /** Fired when the chip's remove (x) button is pressed. */
  onRemove: () => void;
}

/** Removable "active filter" pill: `Label: value` plus an x button. */
export function FilterChip({ label, children, onRemove, className, ...rest }: FilterChipProps) {
  return (
    <button
      type="button"
      className={cx("ui-filter-chip", className)}
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      {...rest}
    >
      <span className="ui-filter-chip-label">{label}</span>
      <span className="ui-filter-chip-value">{children}</span>
      <X aria-hidden="true" />
    </button>
  );
}
