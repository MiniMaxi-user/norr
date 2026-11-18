"use client";
// Popover menu of the web design system (issue #222) — shared by the topbar
// "More" menu, the avatar menu, the page header's ··· and every table row's
// ··· actions. Part of the `web-client` entry.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
  | { type: "custom"; key: string; node: ReactNode };

export interface WebMenuProps {
  /** Accessible name of the trigger. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  /** Marks the trigger as the current location (topbar "More" while one of
   * its items is the active page). */
  triggerActive?: boolean;
  align?: "start" | "end";
  items: WebMenuItem[];
}

/** Small popover menu: opens on click, closes on outside click, Esc or
 * selection; arrow keys move between items. The ··· overflow, topbar "More"
 * and avatar menus all use it. */
export function WebMenu({ label, trigger, triggerClassName, triggerActive, align = "end", items }: WebMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])")?.focus();
  }, [open]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? [],
    );
    if (entries.length === 0) return;
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % entries.length : (index - 1 + entries.length) % entries.length;
    entries[next]?.focus();
  }

  return (
    <div className="web-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        data-active={triggerActive ? "true" : undefined}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="web-menu-popover"
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
      ) : null}
    </div>
  );
}

