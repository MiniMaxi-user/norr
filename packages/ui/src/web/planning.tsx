"use client";
// Planning-page building blocks of the web design system (issue #222, DS 07):
// the header's multiselect dropdown (`WebMultiSelectFilter`, used for the
// Type filter) and the floating, non-modal detail card (`WebFloatingCard`).
// Part of the `web-client` entry; styling lives in `web.css` (`.web-plan-*`).

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

/* ---------------------------------------------------------------------- *
 * Multiselect dropdown
 * ---------------------------------------------------------------------- */

export interface WebMultiSelectOption {
  value: string;
  label: string;
  /** Base colour of the option's dot (any CSS colour). */
  color: string;
  /** Number of records of this option in the current period. */
  count: number;
}

export interface WebMultiSelectFilterProps {
  /** Label inside the trigger ("Type"). */
  label: string;
  /** Overline title of the panel ("Activity type"). */
  panelTitle: string;
  options: readonly WebMultiSelectOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Footer actions. */
  onSelectAll: () => void;
  onSelectDefault: () => void;
  /** "Settings › Activity types". */
  settingsLink?: { href: string; label: string };
}

const PANEL_GAP = 6;

/** Dropdown with a checkbox list for choosing several values at once. The
 * trigger shows the dots of the selected options plus "3 of 4"; the panel
 * (260px) is portalled to <body> with `position: fixed` so no scroll area can
 * clip it, and closes on Esc, outside click, scroll elsewhere or resize. */
export function WebMultiSelectFilter({
  label,
  panelTitle,
  options,
  selected,
  onChange,
  onSelectAll,
  onSelectDefault,
  settingsLink,
}: WebMultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    const below = rect.bottom + PANEL_GAP;
    const top = below + height > window.innerHeight && rect.top - PANEL_GAP - height >= 0 ? rect.top - PANEL_GAP - height : below;
    setStyle({
      top,
      right: Math.max(8, window.innerWidth - rect.right),
      maxHeight: window.innerHeight - 16,
      overflowY: "auto",
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return;
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
    if (open) panelRef.current?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [open]);

  const selectedOptions = options.filter((option) => selected.has(option.value));

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      role="group"
      aria-label={panelTitle}
      className="web-plan-panel"
      style={style}
    >
      <div className="web-plan-panel-title">{panelTitle}</div>
      <div className="web-plan-panel-list">
        {options.map((option) => (
          <label key={option.value} className="web-plan-panel-option">
            <input type="checkbox" checked={selected.has(option.value)} onChange={() => toggle(option.value)} />
            <span className="web-plan-dot" style={{ background: option.color }} aria-hidden="true" />
            <span className="web-plan-panel-label">{option.label}</span>
            <em aria-label={`${option.count} in this period`}>{option.count}</em>
          </label>
        ))}
      </div>
      <div className="web-plan-panel-actions">
        <button type="button" className="web-plan-panel-action" onClick={onSelectAll}>
          All
        </button>
        <button type="button" className="web-plan-panel-action" onClick={onSelectDefault}>
          Default
        </button>
      </div>
      {settingsLink ? (
        <div className="web-plan-panel-foot">
          <Link href={settingsLink.href}>{settingsLink.label}</Link>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="web-plan-ctl"
        data-open={open ? "true" : undefined}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${selectedOptions.length} of ${options.length} selected`}
        onClick={() => {
          setStyle({ visibility: "hidden" });
          setOpen((value) => !value);
        }}
      >
        <span className="web-plan-ctl-label">{label}</span>
        <span className="web-plan-dots" aria-hidden="true">
          {selectedOptions.slice(0, 6).map((option) => (
            <span key={option.value} className="web-plan-dot" style={{ background: option.color }} />
          ))}
        </span>
        <span aria-hidden="true">
          {selectedOptions.length} of {options.length}
        </span>
        <span className="web-plan-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * Floating detail card
 * ---------------------------------------------------------------------- */

export interface WebFloatingCardProps {
  /** The element the card hangs under (a plan block). While it is missing
   * from the DOM the card closes. */
  anchor: HTMLElement | null;
  /** Accessible name of the dialog ("Details WO140"). */
  label: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}

const CARD_GAP = 10;
const VIEWPORT_MARGIN = 8;

/** Floating, NON-modal card under an anchor with an arrow pointing at it
 * (DS 07 section 7): no overlay, the page behind stays usable. Rendered in a
 * portal; flips above the anchor when there is no room below and slides left
 * when there is none to the right. Esc closes and returns focus to the anchor;
 * a mousedown outside (that is not on the anchor) closes; focus moves into the
 * card on open. `role="dialog"` with an `aria-label`, never `aria-modal`. */
export function WebFloatingCard({ anchor, label, onClose, width = 330, children }: WebFloatingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arrowLeft: number; side: "below" | "above" } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchor) return undefined;
    function place() {
      const card = cardRef.current;
      if (!anchor || !card) return;
      if (!anchor.isConnected) {
        onCloseRef.current();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const height = card.offsetHeight;
      const fitsBelow = rect.bottom + CARD_GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
      const fitsAbove = rect.top - CARD_GAP - height >= VIEWPORT_MARGIN;
      const side: "below" | "above" = fitsBelow || !fitsAbove ? "below" : "above";
      const top = side === "below" ? rect.bottom + CARD_GAP : rect.top - CARD_GAP - height;
      let left = rect.left;
      if (left + width > window.innerWidth - VIEWPORT_MARGIN) left = rect.right - width;
      left = Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width));
      const anchorCentre = rect.left + Math.min(rect.width, 400) / 2;
      const arrowLeft = Math.min(Math.max(16, anchorCentre - left), width - 16);
      setPos((prev) =>
        prev && prev.top === top && prev.left === left && prev.arrowLeft === arrowLeft && prev.side === side
          ? prev
          : { top, left, arrowLeft, side },
      );
    }
    place();
    let frame = 0;
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    }
    // Follows the anchor while a scroll area under it moves.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (cardRef.current) resizeObserver?.observe(cardRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
    };
  }, [anchor, width]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || anchor?.contains(target)) return;
      onCloseRef.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
      anchor?.focus({ preventScroll: true });
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor]);

  if (!anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="web-plan-float"
      data-side={pos?.side ?? "below"}
      style={{
        width,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <span className="web-plan-float-arrow" style={{ left: pos?.arrowLeft ?? 24 }} aria-hidden="true" />
      {children}
    </div>,
    document.body,
  );
}
