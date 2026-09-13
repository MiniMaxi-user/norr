import type { ReactNode } from "react";
import { cx } from "../cx";
import { Minus, Plus } from "../icons";
import { IconButton } from "./button";

export interface StepperProps {
  /** Called when the decrement (`-`) button is pressed — the caller owns the
   * actual value/clamping/persistence, this component is pure chrome around
   * two buttons and a value slot. */
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  decrementLabel?: string;
  incrementLabel?: string;
  /** The value display/editor sandwiched between the two buttons — typically
   * a small `Input` (so the value stays directly typable, not just
   * increment/decrement-only) or, for a read-only render, a plain `Text`. */
  children: ReactNode;
  className?: string;
}

/**
 * A "-"/value/"+" control (issue #181's Voorraad stock quantity editor: "Artikelen
 * zijn met plusjes en minnetjes omhoog omlaag te zetten") — deliberately just
 * the two `IconButton`s + a slot for the value, not an opinionated numeric
 * input of its own: a caller with a plain integer quantity passes a small
 * `Input`, a caller that only ever shows the number (a read-only viewer) can
 * pass plain text instead. No internal state or "use client" needed — same
 * "no state, the caller owns the controlled value" shape as `Slider`; the
 * caller (always a client component, since a stepper is only meaningful
 * wired to `onClick`) owns both the value and what happens when the buttons
 * are pressed.
 */
export function Stepper({
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  decrementLabel = "Decrease",
  incrementLabel = "Increase",
  children,
  className,
}: StepperProps) {
  return (
    <div className={cx("ui-stepper", className)}>
      <IconButton
        type="button"
        aria-label={decrementLabel}
        onClick={onDecrement}
        disabled={decrementDisabled}
      >
        <Minus />
      </IconButton>
      <span className="ui-stepper-value">{children}</span>
      <IconButton type="button" aria-label={incrementLabel} onClick={onIncrement} disabled={incrementDisabled}>
        <Plus />
      </IconButton>
    </div>
  );
}
