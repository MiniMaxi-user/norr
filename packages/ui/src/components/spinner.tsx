import type { SVGProps } from "react";
import { cx } from "../cx";

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Rendered height in px (width follows the mark's own aspect ratio,
   * viewBox 63:53) — same convention as `Logomark`. Defaults to 24. Per the
   * brand doc's "icoon minimaal 16px" floor (docs/logo/LEESMIJ.txt), don't
   * pass anything smaller than 16. */
  size?: number;
  /** Accessible label — defaults to "Loading". Rendered as the SVG's own
   * `aria-label` (`role="img"`), same as `Logomark`, since a spinner is real
   * status information for assistive tech, not decoration. */
  label?: string;
}

/**
 * Branded loading indicator (issue #140) — the norr "N" mark
 * (docs/logo/norr-icoon-n.svg) with a CSS stroke "draw-on" loop instead of a
 * generic spinner glyph, so even a loading state reads as this product, not
 * a wireframe. Same two-path drawing as `Logomark`/`Logo`'s `IconMark`
 * (kept as a separate component rather than reused, since this one needs its
 * own `pathLength`/animation classes on each path) — the main N stroke
 * tracks `currentColor` (Fjord on light backgrounds, Snö on dark, per the
 * caller's own `color`), the peillijn accent is always hardcoded Mässing
 * gold (`#C79A3E`), matching brand rules: "de peillijn... uitsluitend de
 * peillijn, nooit de letters".
 *
 * Animation is pure CSS (see the `.ui-spinner*` rules + `@keyframes` in
 * styles.css): both paths set `pathLength="1"`, which lets the stylesheet
 * animate `stroke-dashoffset` from `1` (fully hidden) to `0` (fully drawn)
 * without computing real geometric path length. The N draws first; the
 * peillijn draws in shortly after via a staggered `animation-delay` on the
 * same keyframes, then both erase and loop. No `rotate`/`scaleX(-1)`/`skew`
 * anywhere — the brand doc is explicit ("niet roteren, spiegelen of
 * schuinzetten") and that rule applies to the animation too, not just the
 * static mark. `prefers-reduced-motion: reduce` swaps the draw loop for a
 * static mark with a slow, subtle opacity pulse (see styles.css) — no
 * stroke motion, no transforms, so it's safe for anyone who's opted out of
 * motion.
 */
export function Spinner({ size = 24, label = "Loading", className, ...rest }: SpinnerProps) {
  return (
    <svg
      className={cx("ui-spinner", className)}
      viewBox="0.5 5.5 63 53"
      fill="none"
      strokeLinecap="butt"
      role="img"
      aria-label={label}
      width={(size * 63) / 53}
      height={size}
      {...rest}
    >
      <path className="ui-spinner-n" d="M14 54 V14 L50 46 V10" stroke="currentColor" strokeWidth={7} pathLength={1} />
      <path className="ui-spinner-peillijn" d="M50 46 L62.4 57" stroke="#C79A3E" strokeWidth={3} pathLength={1} />
    </svg>
  );
}
