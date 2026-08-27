import type { InputHTMLAttributes } from "react";
import { cx } from "../cx";

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * A single continuous value control — a native `<input type="range">`
 * restyled to match this design system's tokens (accent-colored track fill +
 * thumb), same "style the real input, don't invent a fake one" approach as
 * `Switch`/`Checkbox`/`RadioGroupItem`. No state, no "use client" needed;
 * the caller (a client component, since a slider is only ever meaningful
 * wired to `onChange`) owns the controlled `value`.
 *
 * Added for the profile panel's avatar crop-zoom control (issue #49) — the
 * first slider need in this app — but generic, not avatar-specific.
 */
export function Slider({ className, ...rest }: SliderProps) {
  return <input type="range" className={cx("ui-slider", className)} {...rest} />;
}
