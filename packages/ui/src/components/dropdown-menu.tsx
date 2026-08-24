import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
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
  return (
    <>
      <div className="ui-dropdown-menu-backdrop" onClick={onClose} />
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

export interface DropdownMenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Renders as a `Link` instead of a `<button>` when given (e.g. "Settings"
   * navigating to a real route) — ignored while `disabled`. */
  href?: string;
  type?: "button" | "submit";
  icon?: ReactNode;
  /** Danger styling for a destructive action (e.g. "Log out"). */
  danger?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

function DropdownMenuItem({
  href,
  type = "button",
  icon,
  danger,
  disabled,
  className,
  children,
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
      <Link href={href} role="menuitem" className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type={type} role="menuitem" className={classes} disabled={disabled} {...rest}>
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
