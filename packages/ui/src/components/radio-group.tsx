import type { HTMLAttributes, InputHTMLAttributes } from "react";
import { cx } from "../cx";

export type RadioGroupProps = HTMLAttributes<HTMLDivElement>;

/** Layout wrapper for a set of mutually-exclusive `RadioGroupItem`s. Native
 * `<input type="radio">` elements sharing a `name` already group and
 * keyboard-navigate themselves in the browser, so — unlike a Radix-based
 * version — this needs no JS/context at all. */
export function RadioGroup({ className, children, ...rest }: RadioGroupProps) {
  return (
    <div role="radiogroup" className={cx("ui-radio-group", className)} {...rest}>
      {children}
    </div>
  );
}

export interface RadioGroupItemProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Marks the item as invalid, switching the ring to the danger token. */
  error?: boolean;
}

/** A single radio button — pair with `Label` for the visible option text,
 * same composition pattern as `Checkbox`. */
export function RadioGroupItem({ className, error, ...rest }: RadioGroupItemProps) {
  return (
    <input
      type="radio"
      aria-invalid={error || undefined}
      className={cx("ui-radio", error && "ui-radio-danger", className)}
      {...rest}
    />
  );
}
