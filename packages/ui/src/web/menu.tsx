"use client";
// Popover menu of the web design system (issue #222) — shared by the topbar
// "More" menu, the avatar menu, the page header's ··· and every table row's
// ··· actions. Part of the `web-client` entry.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export type WebMenuItem =
  | {
      type?: "item";
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      href?: string;
      onSelect?: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: "separator"; key: string }
  | { type: "label"; key: string; node: ReactNode }
  /** Arbitrary node (e.g. a logout `<form>`); the menu does not close on
   * click, so the node owns its own submit/close behaviour. */
  | { type: "custom"; key: string; node: ReactNode }
  /** Toggleable option (role=menuitemcheckbox); the menu stays open so
   * several can be toggled in a row (multiselect filters). */
  | { type: "checkbox"; key: string; label: ReactNode; checked: boolean; onToggle: () => void };

export interface WebMenuProps {
  /** Accessible name of the trigger. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  /** Marks the trigger as the current location (topbar "More" while one of
   * its items is the active page). */
  triggerActive?: boolean;
  align?: "start" | "end";
  /** Roving-tabindex hosts (StructureTree rows) pass -1 for rows that are not
   * the active one. */
  triggerTabIndex?: number;
  items: WebMenuItem[];
}

const POPOVER_GAP = 6;

/** Small popover menu: opens on click, closes on outside click, Esc, scroll of
 * any area, resize or selection; arrow keys move between items. The popover
 * is rendered in a portal on <body> with `position: fixed` (coordinates taken
 * from the trigger), so a scroll area or card can never clip it (01 section 5,
 * floating layers). The ··· overflow, topbar "More" and avatar menus all use
 * it. */
export function WebMenu({ label, trigger, triggerClassName, triggerActive, align = "end", triggerTabIndex, items }: WebMenuProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Position under (or, when there is no room below, above) the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const triggerEl = triggerRef.current;
    const popover = popoverRef.current;
    if (!triggerEl || !popover) return;
    const rect = triggerEl.getBoundingClientRect();
    // A trigger stretching over the full topbar height leaves no gap.
    const gap = triggerEl.closest(".web-topbar") ? 0 : POPOVER_GAP;
    const height = popover.offsetHeight;
    const below = rect.bottom + gap;
    const top = below + height > window.innerHeight && rect.top - gap - height >= 0 ? rect.top - gap - height : below;
    const next: CSSProperties = { top, maxHeight: window.innerHeight - 16, overflowY: "auto" };
    if (align === "end") next.right = Math.max(8, window.innerWidth - rect.right);
    else next.left = Math.max(8, rect.left);
    setStyle(next);
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    // The popover is positioned once: close it when the area under it scrolls
    // (capture, since scroll events do not bubble) or the window resizes.
    function onScroll(event: Event) {
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>("[role='menuitem']:not([aria-disabled='true']), [role='menuitemcheckbox']")?.focus({
      preventScroll: true,
    });
  }, [open]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = Array.from(
      popoverRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true']), [role='menuitemcheckbox']") ?? [],
    );
    if (entries.length === 0) return;
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % entries.length : (index - 1 + entries.length) % entries.length;
    entries[next]?.focus();
  }

  const popover = open ? (
    <div
      ref={popoverRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className="web-menu-popover"
      style={style}
      data-align={align}
      data-web-menu-open="true"
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item) => {
        if (item.type === "separator") return <hr key={item.key} className="web-menu-separator" />;
        if (item.type === "label") {
          return (
            <div key={item.key} className="web-menu-label">
              {item.node}
            </div>
          );
        }
        if (item.type === "custom") return <div key={item.key}>{item.node}</div>;
        if (item.type === "checkbox") {
          return (
            <button
              key={item.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.checked}
              className="web-menu-item"
              onClick={item.onToggle}
            >
              <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-hidden="true" />
              {item.label}
            </button>
          );
        }
        const content = (
          <>
            {item.icon}
            {item.label}
          </>
        );
        if (item.href && !item.disabled) {
          return (
            <Link
              key={item.key}
              href={item.href}
              role="menuitem"
              className="web-menu-item"
              onClick={() => setOpen(false)}
            >
              {content}
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className="web-menu-item"
            data-danger={item.danger ? "true" : undefined}
            aria-disabled={item.disabled ? "true" : undefined}
            onClick={() => {
              if (item.disabled) return;
              setOpen(false);
              item.onSelect?.();
            }}
          >
            {content}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="web-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        tabIndex={triggerTabIndex}
        data-active={triggerActive ? "true" : undefined}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setStyle({ visibility: "hidden" });
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </button>
      {popover && typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </div>
  );
}
