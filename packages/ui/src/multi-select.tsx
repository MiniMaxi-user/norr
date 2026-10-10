"use client";
// New primitive (issues #210/#211): a multi-select filter dropdown — a button
// that opens a popover of checkbox options (e.g. the Quotes overview's
// Status / Type filters). Owns open state and outside-click/Escape handling,
// so — like combobox.tsx — it needs its own dedicated "use client" tsup build
// entry at the top level of `src/` (see tsup.config.ts's top-of-file comment).

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { ChevronDown } from "./icons";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  /** Visible filter name, shown on the trigger (e.g. "Status"). */
  label: string;
  options: MultiSelectOption[];
  /** Currently selected option values (controlled). */
  value: string[];
  onChange: (value: string[]) => void;
  /** Fired once whenever the popover closes — lets a caller commit the
   * (possibly many) toggles made while it was open in one go, e.g. a single
   * URL navigation instead of one per click. */
  onClose?: () => void;
  disabled?: boolean;
  className?: string;
}

function summarize(options: MultiSelectOption[], value: string[]): string {
  const selected = options.filter((option) => value.includes(option.value));
  if (selected.length === 0) return "None";
  if (selected.length === options.length) return "All";
  if (selected.length <= 2) return selected.map((option) => option.label).join(", ");
  return `${selected.length} selected`;
}

/**
 * Accessible multi-select filter: a `button` (aria-haspopup, aria-expanded)
 * toggling a portaled popover (`role="dialog"`) of native checkboxes — native
 * inputs give correct keyboard (Tab / Space) and screen-reader semantics for
 * free. Escape closes and returns focus to the trigger; a press that both
 * starts and ends outside closes it (same mechanism as `Combobox`/`Dialog`,
 * so selecting text never closes it by accident). The popover is portaled to
 * `document.body` so it is never clipped by a scrolling/overflow ancestor.
 * Focus moves to the first checkbox on open; Tab/Shift+Tab cycle within the
 * popover, Up/Down move between controls, Escape returns focus to the trigger.
 * "Select all" / "Clear" shortcuts sit in the popover footer.
 */
export function MultiSelect({ label, options, value, onChange, onClose, disabled, className }: MultiSelectProps) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pointerDownOutsideRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function close(returnFocus: boolean) {
    setOpen(false);
    onCloseRef.current?.();
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 6, left: rect.left, minWidth: rect.width });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  // Move focus into the popover (first checkbox) once it has been positioned.
  const positioned = position !== null;
  useEffect(() => {
    if (open && positioned) popoverRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return undefined;
    function isOutside(target: Node) {
      return !triggerRef.current?.contains(target) && !popoverRef.current?.contains(target);
    }
    function handlePointerDown(event: PointerEvent) {
      pointerDownOutsideRef.current = isOutside(event.target as Node);
    }
    function handlePointerUp(event: PointerEvent) {
      if (pointerDownOutsideRef.current && isOutside(event.target as Node)) close(false);
    }
    function focusables(): HTMLElement[] {
      return Array.from(popoverRef.current?.querySelectorAll<HTMLElement>("input, button") ?? []);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
        return;
      }
      const items = focusables();
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") {
        // The popover is portaled to the end of <body>, so natural tab order
        // would skip past it: cycle focus inside it instead.
        event.preventDefault();
        const next = event.shiftKey ? index - 1 : index + 1;
        items[(next + items.length) % items.length]?.focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && index >= 0) {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        items[(next + items.length) % items.length]?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle(optionValue: string) {
    onChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  }

  const popoverId = `${baseId}-popover`;

  return (
    <div className={cx("ui-multi-select", className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cx("ui-multi-select-trigger", open && "ui-multi-select-trigger-open")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="ui-multi-select-label">{label}</span>
        <span className="ui-multi-select-summary">{summarize(options, value)}</span>
        <ChevronDown className="ui-multi-select-caret" aria-hidden="true" />
      </button>

      {open && !disabled && position && typeof document !== "undefined"
        ? createPortal(
            (() => {
              const style: CSSProperties = { top: position.top, left: position.left, minWidth: position.minWidth };
              return (
                <div
                  ref={popoverRef}
                  id={popoverId}
                  role="dialog"
                  aria-label={`${label} filter`}
                  className="ui-multi-select-popover"
                  style={style}
                >
                  <div className="ui-multi-select-options">
                    {options.map((option) => (
                      <label key={option.value} className="ui-multi-select-option">
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          checked={value.includes(option.value)}
                          onChange={() => toggle(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="ui-multi-select-footer">
                    <button
                      type="button"
                      className="ui-multi-select-action"
                      onClick={() => onChange(options.map((option) => option.value))}
                    >
                      Select all
                    </button>
                    <button type="button" className="ui-multi-select-action" onClick={() => onChange([])}>
                      Clear
                    </button>
                  </div>
                </div>
              );
            })(),
            document.body,
          )
        : null}
    </div>
  );
}
