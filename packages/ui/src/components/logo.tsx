import type { ReactNode, SVGProps } from "react";

export interface LogoProps {
  /** Overridable accessible label — defaults to "Norr". There's no visible
   * text slot anymore (the SVG wordmark below already draws the name), so
   * this only ever affects the `aria-label` on the mark, not what renders
   * on screen. */
  children?: ReactNode;
}

/**
 * Full wordmark (docs/logo/norr-logotype-klein.svg, `currentColor`) — the
 * heavier-stroke "klein" drawing, since the sidebar always renders this
 * under the brand doc's 34px-height threshold where the regular-weight
 * logotype reads as too thin (docs/logo/LEESMIJ.txt). The letters track
 * `currentColor` (→ `--ui-fg`, adapts to light/dark automatically); the
 * brass "peillijn" stroke is hardcoded per brand rules — messing is never
 * used for the letters themselves, only this one diagonal accent stroke.
 */
function Wordmark({ label, ...rest }: SVGProps<SVGSVGElement> & { label: string }) {
  return (
    <svg viewBox="11 7 145 54" fill="none" strokeLinecap="butt" role="img" aria-label={label} {...rest}>
      <path d="M14 54 V14 L50 46 V10" stroke="currentColor" strokeWidth={7} />
      <path d="M50 46 L62.4 57" stroke="#C79A3E" strokeWidth={3} />
      <circle cx={78} cy={41} r={13} stroke="currentColor" strokeWidth={7} />
      <path d="M104 54 V29" stroke="currentColor" strokeWidth={7} />
      <path d="M104 37 C104 29 110 27 119 27.5" stroke="currentColor" strokeWidth={7} />
      <path d="M131 54 V29" stroke="currentColor" strokeWidth={7} />
      <path d="M131 37 C131 29 137 27 146 27.5" stroke="currentColor" strokeWidth={7} />
    </svg>
  );
}

/**
 * Standalone "N" mark with its peillijn (docs/logo/norr-icoon-n.svg,
 * `currentColor`) — the icon-only drawing shared by the collapsed sidebar
 * (via `Logo`'s internal CSS toggle, see styles.css's
 * `.ui-sidebar-collapsed .ui-logo-icon-mark`) and by `Logomark` below, which
 * exports this same mark standalone for spots that aren't part of that
 * toggle — e.g. the corner of the login screen's illustration panel. Per
 * brand rules the bare N is never placed next to the full name.
 */
function IconMark({ label, ...rest }: SVGProps<SVGSVGElement> & { label: string }) {
  return (
    <svg viewBox="0.5 5.5 63 53" fill="none" strokeLinecap="butt" role="img" aria-label={label} {...rest}>
      <path d="M14 54 V14 L50 46 V10" stroke="currentColor" strokeWidth={7} />
      <path d="M50 46 L62.4 57" stroke="#C79A3E" strokeWidth={3} />
    </svg>
  );
}

export function Logo({ children }: LogoProps) {
  const label = typeof children === "string" ? children : "Norr";
  return (
    <span className="ui-logo">
      <Wordmark className="ui-logo-full-mark" label={label} />
      <IconMark className="ui-logo-icon-mark" label={label} />
    </span>
  );
}

export interface LogomarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Rendered height in px (width follows the mark's own aspect ratio,
   * viewBox 63:53). Defaults to 20 — this component isn't inside the
   * sidebar's own `.ui-logo-icon-mark` CSS sizing, so (unlike `Logo`) it
   * needs an explicit default. */
  size?: number;
  children?: ReactNode;
}

/**
 * Standalone icon-only "N" mark (see `IconMark` above) for use outside the
 * sidebar's expand/collapse toggle — e.g. the login screen's illustration
 * corner. Tracks `currentColor` for the letter strokes (so a caller can set
 * `color`/a text-tone className to place it on light or dark art) with the
 * brass peillijn stroke fixed per brand rules, same as `Logo`.
 */
export function Logomark({ size = 20, children, ...rest }: LogomarkProps) {
  const label = typeof children === "string" ? children : "Norr";
  return <IconMark label={label} width={(size * 63) / 53} height={size} {...rest} />;
}
