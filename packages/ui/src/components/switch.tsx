import type { InputHTMLAttributes } from "react";
import { cx } from "../cx";

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** On/off toggle — a native `<input type="checkbox">` drawn as a switch
 * purely with CSS (`:checked` moves the thumb via `::before`), the same
 * "style the real input, don't invent a fake one" approach `Checkbox` uses.
 * No state, no "use client" needed. */
export function Switch({ className, ...rest }: SwitchProps) {
  return <input type="checkbox" role="switch" className={cx("ui-switch", className)} {...rest} />;
}
