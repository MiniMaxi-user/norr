import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type ProgressTone = "accent" | "success" | "danger" | "warning";

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /** Current value. */
  value?: number;
  /** Value ceiling; `value` is expressed as a fraction of this. */
  max?: number;
  /** Matches the tone vocabulary `Badge` already uses. */
  tone?: ProgressTone;
}

/** Determinate progress bar — a plain div with an inline `width`, no
 * library. Purely presentational (a fixed `value` prop, not owned state),
 * so — like every other primitive here — it renders fine from a Server
 * Component. */
export function Progress({ value = 0, max = 100, tone = "accent", className, ...rest }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cx("ui-progress", className)}
      {...rest}
    >
      <div className={cx("ui-progress-indicator", `ui-progress-${tone}`)} style={{ width: `${pct}%` }} />
    </div>
  );
}
