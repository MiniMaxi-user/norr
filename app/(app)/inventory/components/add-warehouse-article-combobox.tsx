"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Input, Spinner, Text } from "@yourorg/ui";
import { addArticleToWarehouse, searchArticlesToAddToWarehouse, type WarehouseArticleSearchResult } from "../actions";
import { formatCurrency } from "@/lib/format/currency";

export interface AddWarehouseArticleComboboxProps {
  warehouseId: string;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "+ Article" search field for a warehouse's stock table (issue #181) —
 * type-and-search, server-side via `searchArticlesToAddToWarehouse` (which
 * already excludes articles this warehouse holds, per that action's own doc
 * comment), select a result to `addArticleToWarehouse` immediately.
 *
 * Deliberately NOT the shared `Combobox` (`@yourorg/ui`) — that component's
 * contract is "caller passes the full option list upfront, it filters
 * in-memory as you type" (see its own doc comment), which doesn't fit a
 * per-warehouse, per-keystroke, server-filtered + server-excluded search
 * against the whole article catalog. Reuses that component's own documented
 * `.ui-combobox`/`.ui-combobox-listbox`/`.ui-combobox-option` CSS classes
 * directly (CLAUDE.md rule 4: design-system tokens, not ad-hoc styling) —
 * same "reach for the public `ui-*` class directly" convention
 * `ui-row-actions`/`ui-summary-row-reserved` already establish for a shape
 * with no dedicated component of its own. No portal (unlike `Combobox`) —
 * this control never sits inside a clipping/scrolling ancestor, so a plain
 * `position: absolute` dropdown is enough.
 *
 * Keyboard handling is ported from `Combobox`'s own `handleKeyDown`
 * (ArrowDown/ArrowUp move a highlighted index with wraparound, Enter selects
 * the highlighted result, Escape closes) — adapted for results that arrive
 * asynchronously per-keystroke rather than a static filtered list: the
 * highlighted index resets to 0 whenever a fresh `results` array lands
 * (mirroring `Combobox`'s own clamp-on-filteredOptions-change effect) since
 * there's no stable identity to preserve across one server response and the
 * next. Focus never leaves the input — arrow keys/Enter/Escape are all
 * handled on the `<input>` itself, matching `Combobox`'s own "listbox items
 * are click/hover targets only" split.
 */
export function AddWarehouseArticleCombobox({ warehouseId }: AddWarehouseArticleComboboxProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<WarehouseArticleSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      setOpen(false);
      return;
    }
    // Open immediately (showing the "Searching…" row) rather than waiting
    // for the debounced request to resolve — otherwise the dropdown only
    // ever appears already-settled and a user never sees search-in-progress
    // feedback for their own keystroke.
    setIsSearching(true);
    setOpen(true);
    const timeout = setTimeout(async () => {
      const result = await searchArticlesToAddToWarehouse(warehouseId, trimmed);
      setIsSearching(false);
      if (!result.data) {
        setError(result.error ?? "Could not search articles.");
        setResults([]);
        return;
      }
      setError(null);
      setResults(result.data.articles);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, warehouseId]);

  // Highlighted index resets to the top whenever a fresh results array
  // lands (new keystroke's server response, or the list clearing) — same
  // "clamp/reset on filteredOptions change" idea `Combobox` applies to its
  // own (synchronous) filtered list, just triggered by the async result
  // instead.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [results]);

  // Click-outside-to-close — same "outside" concept `Combobox` uses, simpler
  // (pointerdown only) since there's no in-progress text selection to
  // protect: this field isn't pre-filled with a selected value to preserve.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  async function handleSelect(article: WarehouseArticleSearchResult) {
    setAddingId(article.id);
    setError(null);
    const result = await addArticleToWarehouse(warehouseId, article.id);
    setAddingId(null);
    if (!result.data) {
      setError(result.error ?? "Could not add this article.");
      return;
    }
    setQuery("");
    setResults([]);
    setOpen(false);
    setHighlightedIndex(0);
    router.refresh();
  }

  function close() {
    setOpen(false);
  }

  // Ported from `Combobox`'s own `handleKeyDown` — ArrowDown/ArrowUp move
  // `highlightedIndex` with wraparound, Enter selects whatever's currently
  // highlighted, Escape closes. Reopens on ArrowDown/ArrowUp when there's
  // already a query but the dropdown got closed (click-outside, Escape)
  // rather than moving a nonexistent highlight, same as `Combobox`.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          if (query.trim()) setOpen(true);
          return;
        }
        setHighlightedIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          if (query.trim()) setOpen(true);
          return;
        }
        setHighlightedIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
        return;
      case "Enter": {
        if (!open || isSearching || addingId) return;
        const article = results[highlightedIndex];
        if (!article) return;
        event.preventDefault();
        void handleSelect(article);
        return;
      }
      case "Escape":
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      default:
        return;
    }
  }

  const activeOptionId = open && results[highlightedIndex] ? `${baseId}-option-${results[highlightedIndex].id}` : undefined;

  return (
    <div className="ui-combobox" ref={containerRef}>
      <Input
        role="combobox"
        aria-label="Search articles to add to this warehouse"
        placeholder="Search by article number or description to add…"
        value={query}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {error && <Text tone="danger">{error}</Text>}
      {open && (
        <ul id={listboxId} className="ui-combobox-listbox" role="listbox">
          {isSearching ? (
            <li className="ui-combobox-empty">
              <Spinner size={16} /> Searching…
            </li>
          ) : results.length === 0 ? (
            <li className="ui-combobox-empty">No matching articles</li>
          ) : (
            results.map((article, index) => {
              const highlighted = index === highlightedIndex;
              return (
                <li
                  key={article.id}
                  id={`${baseId}-option-${article.id}`}
                  role="option"
                  aria-selected={highlighted}
                  className={highlighted ? "ui-combobox-option ui-combobox-option-highlighted" : "ui-combobox-option"}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => (addingId ? undefined : handleSelect(article))}
                >
                  <span>
                    {article.article_number} — {article.description}
                  </span>
                  <Text tone="muted">
                    {addingId === article.id ? "Adding…" : formatCurrency(article.sale_price)}
                  </Text>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
