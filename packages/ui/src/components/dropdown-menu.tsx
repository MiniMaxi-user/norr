import type { ButtonHTMLAttributes, HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cx } from "../cx";

/**
 * DropdownMenu — a small anchored menu (topbar user menu, row actions, …).
 * Deliberately hook-free (no `useState`/`useEffect`/context), matching every
 * other compound component in this package (`Dialog`, `CommandPalette`):
 * this file is bundled into the package's main `dist/index.js` alongside
 * dozens of other components reachable from Server Components, and Next's
 * RSC compiler rejects ANY hook usage anywhere in a file reached that way —
 * see tsup.config.ts's top comment. Open state, outside-click and
 * Escape-to-close are the call site's job (it's already a "use client" leaf,
 * since it owns which item is open) — same `open`/`onClose` contract as
 * `Dialog`'s `open`/`onOpenChange`. Not Radix-based: this package has no
 * Radix dependency yet, and adding one here would also require a dedicated
 * client-boundary build entry (see tsup.config.ts) for what a few CSS rules
 * + a transparent click-catcher already solve.
 *
 * ```tsx
 * <DropdownMenu>
 *   <DropdownMenu.Trigger>
 *     <button onClick={() => setOpen((v) => !v)}>...</button>
 *   </DropdownMenu.Trigger>
 *   <DropdownMenu.Content open={open} onClose={() => setOpen(false)} align="end">
 *     <DropdownMenu.Label>Jane Doe</DropdownMenu.Label>
 *     <DropdownMenu.Separator />
 *     <DropdownMenu.Item href="/settings" icon={<Settings />}>Settings</DropdownMenu.Item>
 *   </DropdownMenu.Content>
 * </DropdownMenu>
 * ```
 */
export interface DropdownMenuProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function DropdownMenuRoot({ className, children, ...rest }: DropdownMenuProps) {
  return (
    <div className={cx("ui-dropdown-menu", className)} {...rest}>
      {children}
    </div>
  );
}

export interface DropdownMenuTriggerProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Positioning anchor for `Content` — wrap the caller's own trigger
 * button/element (it owns the actual click handler and `open` state). */
function DropdownMenuTrigger({ className, children, ...rest }: DropdownMenuTriggerProps) {
  return (
    <div className={cx("ui-dropdown-menu-trigger", className)} {...rest}>
      {children}
    </div>
  );
}

export interface DropdownMenuContentProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  /** Called when the transparent backdrop behind the menu is clicked — wire
   * to the same setter that closes it, same contract as `Dialog`'s
   * `onOpenChange(false)`. */
  onClose: () => void;
  align?: "start" | "end";
  children?: ReactNode;
}

function DropdownMenuContent({ open, onClose, align = "end", className, children, ...rest }: DropdownMenuContentProps) {
  if (!open) return null;
  // The backdrop is `position: fixed; inset: 0` to catch a click anywhere
  // on the page and close the menu — but `position: fixed` resolves against
  // the nearest ancestor that establishes its own containing block (any
  // `filter`/`backdrop-filter`/`transform`/`perspective`/`will-change`), not
  // necessarily the viewport. `Topbar`'s `.ui-toolbar` (a very plausible
  // ancestor for this exact menu — see `components/shell/user-menu.tsx`) has
  // `backdrop-filter: blur(10px)` for its glass effect, which silently
  // shrinks `inset: 0` down to the toolbar's own (short) box instead of the
  // full page — clicking anywhere below the topbar then does nothing, the
  // menu never closes. Portal ONLY the backdrop to `document.body` (a real
  // sibling of every such ancestor) so it always covers the true viewport,
  // regardless of what filter/transform any future call site's ancestors
  // use. The menu content itself stays exactly where it is in the DOM/JSX
  // below — it must, since its `position: absolute` anchoring depends on
  // `.ui-dropdown-menu`'s `position: relative` wrapper being a normal DOM
  // ancestor; portaling it too would lose that anchor and need
  // `getBoundingClientRect` + state to reposition, which would require a
  // hook this file deliberately can't have (see the file's top doc
  // comment). `typeof document` guards the (never actually hit, since
  // `open` only ever becomes `true` from post-hydration client state) case
  // of this rendering during SSR, where there is no `document`.
  const backdrop =
    typeof document === "undefined"
      ? null
      : createPortal(<div className="ui-dropdown-menu-backdrop" onClick={onClose} />, document.body);
  return (
    <>
      {backdrop}
      <div
        role="menu"
        className={cx("ui-dropdown-menu-content", align === "start" && "ui-dropdown-menu-content-start", className)}
        {...rest}
      >
        {children}
      </div>
    </>
  );
}

export interface DropdownMenuLabelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function DropdownMenuLabel({ className, children, ...rest }: DropdownMenuLabelProps) {
  return (
    <div className={cx("ui-dropdown-menu-label", className)} {...rest}>
      {children}
    </div>
  );
}

function DropdownMenuSeparator({ className, ...rest }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx("ui-dropdown-menu-separator", className)} {...rest} />;
}

export interface DropdownMenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick"> {
  /** Renders as a `Link` instead of a `<button>` when given (e.g. "Settings"
   * navigating to a real route) — ignored while `disabled`. */
  href?: string;
  type?: "button" | "submit";
  icon?: ReactNode;
  /** Danger styling for a destructive action (e.g. "Log out"). */
  danger?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  /** Fires either way — whether this renders as a `<button>` or (with
   * `href`) a `Link`/`<a>` — e.g. a call site closing the menu on selection
   * (`components/shell/user-menu.tsx`). Typed to accept either element
   * (rather than inherited from `ButtonHTMLAttributes`, which only accepts
   * an `HTMLButtonElement` handler and doesn't type-check against `Link`)
   * since which element actually renders depends on `href`. */
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
}

function DropdownMenuItem({
  href,
  type = "button",
  icon,
  danger,
  disabled,
  className,
  children,
  onClick,
  ...rest
}: DropdownMenuItemProps) {
  const classes = cx("ui-dropdown-menu-item", danger && "ui-dropdown-menu-item-danger", className);
  const content = (
    <>
      {icon && <span className="ui-dropdown-menu-item-icon">{icon}</span>}
      {children}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} role="menuitem" className={classes} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <button type={type} role="menuitem" className={classes} disabled={disabled} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}

export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  Trigger: DropdownMenuTrigger,
  Content: DropdownMenuContent,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Item: DropdownMenuItem,
});
