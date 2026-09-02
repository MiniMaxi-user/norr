"use client";
// New primitive (issue #54): the shared "search field with a dropdown of
// matching options, filtered as you type" pattern needed for Brand/Type/
// Sub-type/Model pickers (this issue's Asset Model manager, and issue #53's
// Asset form once unblocked). Genuinely interactive (owns open/query/
// highlighted-index state), so — same as client.tsx/tabs.tsx/toast.tsx — it
// needs its OWN dedicated "use client" tsup build entry rather than living
// in the hook-free main index.js bundle Server Components import; see
// tsup.config.ts's top-of-file comment for the full "why a sibling file, not
// inlined into index.ts" story. Lives at the top level of `src/` (not under
// `src/components/`), same as client.tsx/tabs.tsx/toast.tsx — required, not
// just cosmetic: `index.ts` imports this module as the literal relative
// specifier `"./combobox.js"`, which the CJS build (the one build config
// where this module is NOT marked `external` — see tsup.config.ts) must be
// able to physically resolve on disk relative to `index.ts`'s own directory;
// nesting it under `components/` broke exactly that resolution (confirmed
// empirically: `npm run build -w @yourorg/ui` failed with "Could not resolve
// './combobox.js'" until this file was moved back up to `src/`).

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { Check, ChevronDown, X } from "./icons";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra text matched during filtering but never displayed — e.g. an
   * article's EAN/GTIN/MPN alongside a `label` that only shows its article
   * number + description (issue #95's Quote line item article picker, which
   * needs "search by article number, EAN, GTIN, description" without
   * cluttering the visible label with every one of those). Defaults to
   * matching against `label` alone when omitted — every existing caller's
   * filtering behavior is unchanged. */
  keywords?: string;
}

export interface ComboboxProps {
  /** Every selectable option — this component filters internally as the
   * user types, so callers pass the full unfiltered list once (same
   * "caller passes everything, component derives the filtered view"
   * contract as `CascadingSelect`). */
  options: ComboboxOption[];
  /** Selected option's `value`. `""`/`undefined` means no selection. */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Mirrors `value` into a same-named `<input type="hidden">`, so this
   * component works as a real named form control inside a plain
   * `<form action={...}>` / `FormData`-based submit — read
   * `formData.get(name)` in the Server Action exactly like any other named
   * field (see `Select`). Omit when the call site reads `value` from its
   * own controlled state instead (e.g. because it also needs that value to
   * drive a dependent field). */
  name?: string;
  /** Applied to the visible text field for basic HTML5 "you must select
   * something" UX — the underlying Server Action's Zod validation is always
   * the real backstop, same as every other form field in this codebase. */
  required?: boolean;
  /** Shown in the dropdown when the filtered list has zero matches. */
  emptyMessage?: string;
  /** Shows a small "x" button once a value is selected, clearing it back to
   * no selection — for optional fields (e.g. Asset Sub-type) where "no
   * value" is a state the user legitimately needs to get back to. */
  clearable?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * Shared type-to-filter combobox — the acceptance-criteria pattern for every
 * search field with a dropdown of matching options ("als je begint met
 * typen worden de juiste opties getoond"): full keyboard support (Up/Down/
 * Home/End to move, Enter to select, Escape to close), and
 * click-outside-to-close using the same "the press must both START and END
 * outside" mechanism `Dialog` uses (see that component's doc comment) —
 * critical here because selecting/dragging text inside the filter input
 * must never close the dropdown out from under that selection. Deliberately
 * does NOT itself implement cascading/dependent filtering (unlike
 * `CascadingSelect`, which owns that logic for the native-`<select>` case) —
 * a caller with a dependent field (e.g. Asset Sub-type scoped by Asset Type)
 * passes it an already-filtered `options` array and remounts via
 * `key={typeValue}` or clears `value` itself when the parent changes, same
 * general shape `CascadingSelect`'s own doc comment describes.
 *
 * The listbox is portaled to `document.body` (Quote line items redesign) —
 * it used to render as a plain `position: absolute` child of `.ui-combobox`,
 * which broke inside any scrolling/clipping ancestor (e.g. `.ui-table-wrap`,
 * which needs `overflow-x: auto` for wide-table horizontal scroll — see that
 * class's own comment in styles.css — and per a CSS spec quirk, setting
 * `overflow-x` to anything but `visible` forces the computed `overflow-y` to
 * resolve to `auto` too when left unset, so the listbox got clipped/reordered
 * underneath later page content instead of floating on top of it). Same fix
 * `Dialog` already uses (see that component's own doc comment) — portaling
 * out of the clipping context entirely, rather than fighting `.ui-table-wrap`'s
 * own overflow behavior. Position is computed from the trigger's own
 * `getBoundingClientRect()` (viewport-relative, matching `position: fixed`)
 * and re-measured on scroll/resize while open — see the `position` state
 * below. `.ui-combobox-listbox-portal`'s `z-index` is higher than
 * `.ui-dialog-overlay`'s (100) so a Combobox opened from inside a Dialog
 * (`AssetFormDialog`, `ArticleFormPanel`, …) still renders above that
 * dialog's own surface once portaled out of it, matching what it looked like
 * pre-portal (a plain DOM descendant always painted on top of its own
 * ancestor).
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  disabled,
  id,
  name,
  required,
  emptyMessage = "No matches",
  clearable,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ComboboxProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const listboxId = `${baseId}-listbox`;

  const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const pointerDownOutsideRef = useRef(false);

  // Viewport-relative position for the portaled listbox (see this file's own
  // doc comment) — re-measured whenever the dropdown opens and on every
  // scroll/resize while it stays open, so it tracks the trigger even inside
  // a scrolling ancestor (e.g. `.ui-table-wrap`). `capture: true` on the
  // scroll listener catches scroll events from ANY scrollable ancestor, not
  // just `window` (a plain non-capturing `window` listener only fires for
  // the document/window's own scroll, never an inner `overflow: auto` div).
  const [listboxPosition, setListboxPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setListboxPosition(null);
      return undefined;
    }
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setListboxPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  // Keep the visible text in sync with the *selected* option whenever the
  // dropdown is closed (covers an external `value` change — e.g. a parent
  // form resetting this field — as well as closing without picking anything
  // new). While open, the input shows whatever the user is typing instead.
  useEffect(() => {
    if (!open) setQuery(selectedOption?.label ?? "");
  }, [open, selectedOption?.label]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!open || !q) return options;
    return options.filter((option) =>
      (option.keywords ? `${option.label} ${option.keywords}` : option.label).toLowerCase().includes(q),
    );
  }, [options, query, open]);

  useEffect(() => {
    if (highlightedIndex >= filteredOptions.length) {
      setHighlightedIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [filteredOptions.length, highlightedIndex]);

  function close() {
    setOpen(false);
    setQuery(selectedOption?.label ?? "");
  }

  // Click-outside-to-close: only when a single press both STARTS and ENDS
  // outside this component — see Dialog's identical fix (its own doc
  // comment has the full story). Tracked via plain document pointer
  // listeners rather than `onBlur`, so dragging a text selection out of the
  // input and releasing over unrelated page content can never be
  // misread as "the user clicked away" mid-selection. "Outside" now also
  // excludes `listboxRef` — since the listbox is portaled to `document.body`
  // (see this file's own doc comment), it's no longer a DOM descendant of
  // `containerRef`, so without this a press on an option would register as
  // "outside" the trigger and close the dropdown before `selectOption`'s own
  // `onClick` had a chance to run.
  function isOutside(target: Node) {
    return !containerRef.current?.contains(target) && !listboxRef.current?.contains(target);
  }

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      pointerDownOutsideRef.current = isOutside(event.target as Node);
    }
    function handlePointerUp(event: PointerEvent) {
      const endedOutside = isOutside(event.target as Node);
      if (pointerDownOutsideRef.current && endedOutside) close();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
    };
    // `close` intentionally omitted — it only reads `selectedOption?.label`,
    // which does not need to force this listener to be torn down/re-added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectOption(option: ComboboxOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    setHighlightedIndex(0);
  }

  function handleClear(event: ReactMouseEvent) {
    event.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setHighlightedIndex((index) => (filteredOptions.length === 0 ? 0 : (index + 1) % filteredOptions.length));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setHighlightedIndex((index) =>
          filteredOptions.length === 0 ? 0 : (index - 1 + filteredOptions.length) % filteredOptions.length,
        );
        return;
      case "Enter": {
        if (!open) return;
        const option = filteredOptions[highlightedIndex];
        if (!option) return;
        event.preventDefault();
        selectOption(option);
        return;
      }
      case "Escape":
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setHighlightedIndex(0);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setHighlightedIndex(Math.max(0, filteredOptions.length - 1));
        return;
      default:
        return;
    }
  }

  const activeOptionId =
    open && filteredOptions[highlightedIndex]
      ? `${baseId}-option-${filteredOptions[highlightedIndex].value}`
      : undefined;

  return (
    <div className={cx("ui-combobox", className)} ref={containerRef}>
      <div className="ui-combobox-control">
        <input
          ref={inputRef}
          id={baseId}
          type="text"
          role="combobox"
          className="ui-combobox-input"
          autoComplete="off"
          value={query}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {clearable && value ? (
          <button
            type="button"
            className="ui-combobox-clear"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear selection"
            tabIndex={-1}
          >
            <X />
          </button>
        ) : null}
        <span className="ui-combobox-caret" aria-hidden="true">
          <ChevronDown />
        </span>
      </div>

      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}

      {open && !disabled && listboxPosition && typeof document !== "undefined"
        ? createPortal(
            (() => {
              const style: CSSProperties = {
                position: "fixed",
                top: listboxPosition.top,
                left: listboxPosition.left,
                width: listboxPosition.width,
                right: "auto",
              };
              return (
                <ul
                  ref={listboxRef}
                  id={listboxId}
                  role="listbox"
                  className="ui-combobox-listbox ui-combobox-listbox-portal"
                  style={style}
                >
                  {filteredOptions.length === 0 ? (
                    <li className="ui-combobox-empty">{emptyMessage}</li>
                  ) : (
                    filteredOptions.map((option, index) => {
                      const selected = option.value === value;
                      const highlighted = index === highlightedIndex;
                      return (
                        <li
                          key={option.value}
                          id={`${baseId}-option-${option.value}`}
                          role="option"
                          aria-selected={selected}
                          className={cx(
                            "ui-combobox-option",
                            highlighted && "ui-combobox-option-highlighted",
                            selected && "ui-combobox-option-selected",
                          )}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onClick={() => selectOption(option)}
                        >
                          <span>{option.label}</span>
                          {selected ? <Check className="ui-combobox-option-check" aria-hidden="true" /> : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              );
            })(),
            document.body,
          )
        : null}
    </div>
  );
}
