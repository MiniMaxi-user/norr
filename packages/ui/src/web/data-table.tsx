"use client";
// Interactive data table of the web design system (issue #222, round 2):
// `FilterBar` + `WebDataTableCard` (card, filter bar, sortable table,
// pagination, empty states). Part of the `web-client` entry; see client.tsx.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "../icons";
import { WebButton, WebCard } from "./primitives";
import { WebMenu, type WebMenuItem } from "./menu";
import { getMainScrollArea } from "./scroll";

/* ---------------------------------------------------------------------- *
 * StatusText — status as coloured text, never a badge per row.
 * ---------------------------------------------------------------------- */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Maps a reference-list colour name (`reference_list_items.color`) to a
 * design-system tone. Unknown/empty colours read as plain text. */
export function toneFromColor(color: string | null | undefined): StatusTone {
  switch ((color ?? "").toLowerCase()) {
    case "green":
    case "success":
    case "emerald":
      return "success";
    case "amber":
    case "yellow":
    case "orange":
    case "warning":
    case "gold":
      return "warning";
    case "red":
    case "danger":
    case "rose":
      return "danger";
    case "blue":
    case "teal":
    case "cyan":
    case "info":
    case "sky":
      return "info";
    default:
      return "neutral";
  }
}

export function StatusText({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className="web-status" data-tone={tone}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------- *
 * FilterBar
 * ---------------------------------------------------------------------- */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterBarDropdown {
  id: string;
  /** Label inside the button: "Type" → `Type: All ▾`. */
  label: string;
  /** Selected value; `""` = All. */
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Cascading child: not selectable until its parent has a value. */
  disabled?: boolean;
}

export interface FilterBarSegment {
  /** Accessible name of the radio group. */
  label: string;
  /** Exactly three values; the widest ("All") goes last. */
  options: readonly [FilterOption, FilterOption, FilterOption];
  value: string;
  onChange: (value: string) => void;
}

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Name of the list: "Search sites…". */
  searchPlaceholder: string;
  /** `/` focuses the search field (default on; turn off for the second table
   * on one page). */
  searchShortcut?: boolean;
  dropdowns: FilterBarDropdown[];
  /** Mandatory on every table; only a non-table view of the same data (a
   * board) may leave it out. */
  segment?: FilterBarSegment;
  /** Rows after filtering / all rows. */
  shownCount: number;
  totalCount: number;
  /** True when anything differs from the defaults. */
  filtersActive: boolean;
  onClear: () => void;
  /** The add button (tabs of a detail page): last element, secondary 30px. */
  add?: ReactNode;
}

const MAX_VISIBLE_DROPDOWNS = 3;

function Dropdown({ dropdown }: { dropdown: FilterBarDropdown }) {
  const current = dropdown.options.find((option) => option.value === dropdown.value);
  return (
    <label
      className="web-filter-select"
      data-selected={dropdown.value ? "true" : undefined}
      data-disabled={dropdown.disabled ? "true" : undefined}
    >
      <span className="web-filter-select-face" aria-hidden="true">
        <span className="web-filter-select-label">{dropdown.label}:</span>
        <span className="web-filter-select-value">{current?.label ?? "All"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 9l7 7 7-7" />
        </svg>
      </span>
      <select
        aria-label={dropdown.label}
        value={dropdown.value}
        disabled={dropdown.disabled}
        onChange={(event) => dropdown.onChange(event.target.value)}
      >
        <option value="">All</option>
        {dropdown.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface SegmentedProps {
  label: string;
  options: readonly FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

function Segmented({ segment }: { segment: SegmentedProps }) {
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = segment.options.findIndex((option) => option.value === segment.value);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = segment.options[(index + step + segment.options.length) % segment.options.length];
    if (!next) return;
    segment.onChange(next.value);
    requestAnimationFrame(() => {
      (event.currentTarget.querySelector("[aria-checked='true']") as HTMLElement | null)?.focus();
    });
  }
  return (
    <div className="web-segmented" role="radiogroup" aria-label={segment.label} onKeyDown={onKeyDown}>
      {segment.options.map((option) => {
        const checked = option.value === segment.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="web-segmented-option"
            onClick={() => segment.onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compact radio-group switch between views of the same data (List / Board,
 * List / Map) for a list page's header. Same look as the FilterBar's
 * segmented toggle; the caller owns the state (usually a `?view=` param) and
 * persists the last-used view. Two or three options.
 */
export function WebViewSwitcher({
  label,
  options,
  value,
  onChange,
}: {
  /** Accessible name: "Switch view". */
  label: string;
  options: readonly FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return <Segmented segment={{ label, options, value, onChange }} />;
}

/** The bar directly above every table, inside its card: search, dropdowns
 * (label inside the button), a 3-value segmented control, then count, "Clear
 * filters" and the add button — always in this order. */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchShortcut = true,
  dropdowns,
  segment,
  shownCount,
  totalCount,
  filtersActive,
  onClear,
  add,
}: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchShortcut) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [searchShortcut]);

  const visible = dropdowns.slice(0, MAX_VISIBLE_DROPDOWNS);
  const extra = dropdowns.slice(MAX_VISIBLE_DROPDOWNS);
  const extraItems: WebMenuItem[] = extra.map((dropdown) => ({
    type: "custom",
    key: dropdown.id,
    node: (
      <div className="web-menu-label">
        <Dropdown dropdown={dropdown} />
      </div>
    ),
  }));

  return (
    <div className="web-filterbar" role="search">
      <div className="web-filter-search">
        <Search aria-hidden />
        <input
          ref={inputRef}
          type="text"
          aria-label={searchPlaceholder.replace(/…$/, "")}
          aria-keyshortcuts="/"
          placeholder={searchPlaceholder}
          autoComplete="off"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searchValue) {
              event.stopPropagation();
              onSearchChange("");
            }
          }}
        />
        {searchValue ? (
          <button type="button" className="web-filter-search-clear" aria-label="Clear search" onClick={() => onSearchChange("")}>
            ×
          </button>
        ) : null}
      </div>
      {visible.map((dropdown) => (
        <Dropdown key={dropdown.id} dropdown={dropdown} />
      ))}
      {extra.length > 0 ? (
        <WebMenu
          label="More filters"
          triggerClassName="web-filter-more"
          align="start"
          trigger={<>More filters ▾</>}
          items={extraItems}
        />
      ) : null}
      {segment ? <Segmented segment={segment} /> : null}
      <span className="web-filterbar-count" aria-live="polite">
        {filtersActive ? `${shownCount} of ${totalCount}` : String(shownCount)}
      </span>
      {filtersActive ? (
        <button type="button" className="web-rail-link" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
      {add}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * URL-backed filter state
 * ---------------------------------------------------------------------- */

/** Reads/writes `prefix_key` query params without a server round trip
 * (`history.replaceState` is integrated with `useSearchParams` in the App
 * Router). Params of other tabs and unrelated ones (`?tab=`) are untouched. */
function useUrlParams(prefix: string) {
  const searchParams = useSearchParams();
  // React state is the source of truth for rendering; the URL only mirrors
  // it (for back-navigation and sharing). Relying on `useSearchParams` to
  // pick up `history.replaceState` turned out not to re-render reliably.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith(`${prefix}_`)) initial[key.slice(prefix.length + 1)] = value;
    });
    return initial;
  });
  const get = useCallback((key: string) => values[key] ?? "", [values]);
  const set = useCallback(
    (updates: Record<string, string>) => {
      setValues((previous) => ({ ...previous, ...updates }));
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries(updates)) {
        if (value) url.searchParams.set(`${prefix}_${key}`, value);
        else url.searchParams.delete(`${prefix}_${key}`);
      }
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    },
    [prefix],
  );
  return { get, set };
}

/** Server-driven variant of `useUrlParams`: the real, unprefixed search
 * params (`q`, `seg`, `sort`, `dir`, `page`, one per dropdown id) drive the
 * Server Component, so a change is a `router.replace` inside a transition:
 * the old table stays on screen (dimmed via `pending`) until the new page
 * has streamed in. A local copy answers instantly so toggles and selects
 * never lag behind the round trip. Other params (`view`, `clientId`...) are
 * kept untouched. */
export function useServerParams(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const paramsString = searchParams.toString();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(searchParams.entries()));
  useEffect(() => {
    // Follow back/forward navigation, but never overwrite what the user is
    // typing/choosing while a round trip of their own is still in flight.
    if (enabled && !pending) setValues(Object.fromEntries(new URLSearchParams(paramsString).entries()));
  }, [enabled, paramsString, pending]);
  const get = useCallback((key: string) => values[key] ?? "", [values]);
  const set = useCallback(
    (updates: Record<string, string>) => {
      setValues((previous) => ({ ...previous, ...updates }));
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [router, pathname],
  );
  return { get, set, pending };
}

/* ---------------------------------------------------------------------- *
 * WebDataTableCard
 * ---------------------------------------------------------------------- */

export interface WebColumn<T> {
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Present => the header is a sort button (client-side sorting). */
  sortValue?: (row: T) => string | number | null;
  /** Server mode: the header is a sort button; the server sorts by
   * `?sort=<id>&dir=`. */
  sortable?: boolean;
  /** Numbers, amounts, durations: right-aligned, tabular-nums. */
  align?: "end";
  /** The record's name/ID: rendered as the row's link/button. */
  primary?: boolean;
  /** Mono face for IDs and serial numbers. */
  mono?: boolean;
}

export interface WebDropdownDef<T> {
  id: string;
  label: string;
  /** The option(s) a row belongs to; the dropdown's choices are the union
   * over all rows. Client mode; not needed when `options` is given. */
  getOptions?: (row: T) => FilterOption[];
  /** Fixed choices (server mode, or a known list) instead of deriving them
   * from the rows. */
  options?: FilterOption[];
  /** Ids of dropdowns cleared when this one changes (a parent in a cascade:
   * Client resets Site). */
  resets?: string[];
  /** Cascading child: disabled until its parent dropdown has a value. */
  disabledWhen?: (values: Record<string, string>) => boolean;
}

/** Server-driven mode of `WebDataTableCard` (see its JSDoc). */
export interface WebServerListState {
  /** Rows matching the current filters, over all pages. */
  total: number;
  /** Rows without any filter; drives the `3 of 12` count. Defaults to
   * `total`. */
  unfilteredTotal?: number;
  /** Current page, 1-based. */
  page: number;
  pageSize: number;
}

export interface WebSegmentDef<T> {
  label: string;
  options: readonly [
    FilterOption & { match?: (row: T) => boolean },
    FilterOption & { match?: (row: T) => boolean },
    FilterOption & { match?: (row: T) => boolean },
  ];
  /** Must be one of the option values. */
  defaultValue: string;
}

export interface WebDataTableCardProps<T> {
  /** Card head title. Omit on a list page (the page header carries it): the
   * card then starts with the FilterBar. */
  title?: string;
  /** Mono meta behind the title ("3 · 1 open"). */
  meta?: ReactNode;
  rows: T[];
  getRowKey: (row: T) => string;
  columns: WebColumn<T>[];
  /** Text all searches run against (client mode). */
  searchText?: (row: T) => string;
  /** Plural noun for placeholders and empty states: "sites". */
  noun: string;
  dropdowns: WebDropdownDef<T>[];
  segment: WebSegmentDef<T>;
  /** Namespaces the URL params so tabs/tables don't collide ("sites").
   * Required in client mode; ignored in server mode (plain `q`, `seg`,
   * `sort`, `dir`, `page` params). */
  urlPrefix?: string;
  /** Server-driven mode for a server-paginated list page: `rows` are
   * ALREADY the filtered, sorted current page. The card only renders them
   * and writes search/dropdown/segment/sort/page to the URL
   * (`router.replace` in a transition), which re-runs the Server Component.
   * Dropdowns need `options`; segment `match` and column `sortValue` are not
   * used (flag sortable columns with `sortable`). */
  server?: WebServerListState;
  /** The add button for this tab (secondary 30px, "+ Site"); omit when the
   * user may not create or the table has no add action. */
  add?: ReactNode;
  /** Opens the record: a link target, or a callback (dialogs). */
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Rare row actions in ONE always-visible ··· menu. */
  rowActions?: (row: T) => WebMenuItem[];
  /** Name used in the ··· menu's aria-label. */
  rowLabel?: (row: T) => string;
  /** Row that needs attention (open, running): warning background. */
  isAttention?: (row: T) => boolean;
  defaultSort?: { columnId: string; direction: "asc" | "desc" };
  pageSize?: number;
  /** "No sites yet." and the link that creates the first one. */
  emptyAction?: ReactNode;
  searchShortcut?: boolean;
  loading?: boolean;
  /** One muted explanatory line between the card head and the FilterBar. */
  note?: ReactNode;
  /** Overview preview tables: show at most this many rows, no pagination
   * footer (the card head carries a "Show all" link instead). */
  maxRows?: number;
  /** Right side of the card head — at most one link ("Show all"). */
  headerAction?: ReactNode;
}

const DEFAULT_PAGE_SIZE = 25;

function compareValues(a: string | number | null, b: string | number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The one table pattern of the web design system: a card with title + meta,
 * a `FilterBar`, a real `<table>` (sortable headers, `aria-sort`, no icons in
 * cells, one ··· actions button per row) and a pagination footer for more
 * than one page. Search / dropdowns / segment / sort / page live in the URL
 * under `urlPrefix_*`; changing a filter returns to page 1.
 *
 * Two modes. Client mode (default): `rows` is the whole list, the card
 * filters, sorts and paginates it itself. Server mode (`server` prop, for a
 * list page that is paginated by the server, see `WebListPage`): `rows` is
 * the current page as already filtered/sorted by the server from the URL
 * params, which the card writes with `router.replace`.
 */
export function WebDataTableCard<T>({
  title,
  meta,
  rows,
  getRowKey,
  columns,
  searchText,
  noun,
  dropdowns,
  segment,
  urlPrefix = "t",
  server,
  add,
  rowHref,
  onRowClick,
  rowActions,
  rowLabel,
  isAttention,
  defaultSort,
  pageSize: pageSizeProp = DEFAULT_PAGE_SIZE,
  emptyAction,
  searchShortcut,
  loading,
  note,
  maxRows,
  headerAction,
}: WebDataTableCardProps<T>) {
  const router = useRouter();
  const pageSize = maxRows ?? server?.pageSize ?? pageSizeProp;
  const clientUrl = useUrlParams(urlPrefix);
  const serverUrl = useServerParams(Boolean(server));
  const url = server ? serverUrl : clientUrl;
  const pending = server ? serverUrl.pending : false;
  const q = url.get("q");
  const segValue = url.get("seg") || segment.defaultValue;
  const sortId = url.get("sort") || defaultSort?.columnId || "";
  const sortDir = (url.get("dir") || defaultSort?.direction || "asc") as "asc" | "desc";
  const page = Math.max(1, Number.parseInt(url.get("page") || "1", 10) || 1);

  // Local copy of the search box so typing is instant; the URL follows after
  // 250ms of silence.
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return undefined;
    const timer = setTimeout(() => url.set({ q: searchInput, page: "" }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const dropdownValues = Object.fromEntries(dropdowns.map((dropdown) => [dropdown.id, url.get(dropdown.id)]));

  const dropdownOptions = useMemo(() => {
    const result: Record<string, FilterOption[]> = {};
    for (const dropdown of dropdowns) {
      if (dropdown.options) {
        result[dropdown.id] = dropdown.options;
        continue;
      }
      const seen = new Map<string, string>();
      for (const row of rows) {
        for (const option of dropdown.getOptions?.(row) ?? []) if (!seen.has(option.value)) seen.set(option.value, option.label);
      }
      result[dropdown.id] = [...seen.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    }
    return result;
  }, [dropdowns, rows]);

  const filtered = useMemo(() => {
    if (server) return rows;
    const needle = q.trim().toLowerCase();
    const activeSegment = segment.options.find((option) => option.value === segValue);
    let result = rows.filter((row) => {
      if (activeSegment?.match && !activeSegment.match(row)) return false;
      for (const dropdown of dropdowns) {
        const wanted = dropdownValues[dropdown.id];
        if (wanted && !(dropdown.getOptions?.(row) ?? []).some((option) => option.value === wanted)) return false;
      }
      if (needle && !(searchText?.(row) ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
    const sortColumn = columns.find((column) => column.id === sortId && column.sortValue);
    if (sortColumn?.sortValue) {
      const sortValue = sortColumn.sortValue;
      const factor = sortDir === "desc" ? -1 : 1;
      result = [...result].sort((a, b) => factor * compareValues(sortValue(a), sortValue(b)));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, segValue, JSON.stringify(dropdownValues), sortId, sortDir, columns, dropdowns, segment, searchText, server]);

  const filtersActive =
    Boolean(q) || segValue !== segment.defaultValue || Object.values(dropdownValues).some((value) => Boolean(value));

  const matchCount = server ? server.total : filtered.length;
  const pageCount = Math.max(1, Math.ceil(matchCount / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = server ? rows : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    url.set({
      q: "",
      seg: "",
      page: "",
      ...Object.fromEntries(dropdowns.map((dropdown) => [dropdown.id, ""])),
    });
  }, [dropdowns, url]);

  function toggleSort(column: WebColumn<T>) {
    if (!column.sortValue && !column.sortable) return;
    if (sortId === column.id) url.set({ sort: column.id, dir: sortDir === "asc" ? "desc" : "asc", page: "" });
    else url.set({ sort: column.id, dir: "asc", page: "" });
  }

  function onRowActivate(event: ReactMouseEvent, row: T) {
    if ((event.target as HTMLElement).closest("a,button,select,input,[role='menu']")) return;
    if (rowHref) router.push(rowHref(row));
    else onRowClick?.(row);
  }

  // ---- Scrolling (01 section 5) -------------------------------------------
  // Full tables keep FilterBar + column headers stuck to the top of the
  // centre scroll area; previews (maxRows) do not stick. A table wider than
  // its card scrolls sideways inside the card: the wrapper only becomes a
  // scroll container when that is actually needed, because a scroll container
  // would otherwise swallow the sticky column headers.
  const sticky = !maxRows;
  const hasRowActions = Boolean(rowActions);
  const dropdownKey = JSON.stringify(dropdownValues);
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(51);
  const [scrollX, setScrollX] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    const wrap = wrapRef.current;
    if (!root || !wrap || typeof ResizeObserver === "undefined") return undefined;
    const filterBar = root.querySelector<HTMLElement>(".web-filterbar");
    const measure = () => {
      if (filterBar) setFilterBarHeight(filterBar.offsetHeight);
      setScrollX(wrap.scrollWidth > wrap.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    if (filterBar) observer.observe(filterBar);
    const tableEl = wrap.querySelector("table");
    if (tableEl) observer.observe(tableEl);
    return () => observer.disconnect();
  }, [columns.length, hasRowActions]);

  // A new page, sort or filter returns the centre to the top of this table.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const root = rootRef.current;
    const area = getMainScrollArea();
    const card = root?.closest<HTMLElement>(".web-card");
    if (!area || !card) return;
    const offset = card.getBoundingClientRect().top - area.getBoundingClientRect().top;
    if (offset < 0) area.scrollBy({ top: offset });
  }, [currentPage, q, segValue, sortId, sortDir, dropdownKey]);

  const hasActions = Boolean(rowActions);
  const columnCount = columns.length + (hasActions ? 1 : 0);
  const emptyUnfiltered = server ? !filtersActive : rows.length === 0;

  const body = (
      <div className="web-dt" data-sticky={sticky ? "true" : undefined} ref={rootRef}>
      {note ? <p className="web-card-note">{note}</p> : null}
      <FilterBar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={`Search ${noun}…`}
        searchShortcut={searchShortcut}
        dropdowns={dropdowns.map((dropdown) => ({
          id: dropdown.id,
          label: dropdown.label,
          value: dropdownValues[dropdown.id] ?? "",
          options: dropdownOptions[dropdown.id] ?? [],
          disabled: dropdown.disabledWhen?.(dropdownValues),
          onChange: (value) =>
            url.set({
              [dropdown.id]: value,
              ...Object.fromEntries((dropdown.resets ?? []).map((id) => [id, ""])),
              page: "",
            }),
        }))}
        segment={{
          label: segment.label,
          options: segment.options,
          value: segValue,
          onChange: (value) => url.set({ seg: value === segment.defaultValue ? "" : value, page: "" }),
        }}
        shownCount={matchCount}
        totalCount={server ? (server.unfilteredTotal ?? server.total) : rows.length}
        filtersActive={filtersActive}
        onClear={clearFilters}
        add={add}
      />

      <div
        className="web-table-wrap"
        ref={wrapRef}
        data-scroll-x={scrollX ? "true" : undefined}
        data-pending={pending ? "true" : undefined}
        aria-busy={pending || undefined}
        style={{ "--web-filterbar-h": `${filterBarHeight}px` } as CSSProperties}
      >
      <table className="web-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue || column.sortable);
              const sorted = sortId === column.id && sortable;
              return (
                <th
                  key={column.id}
                  scope="col"
                  data-numeric={column.align === "end" ? "true" : undefined}
                  aria-sort={sorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  data-sorted={sorted ? "true" : undefined}
                >
                  {sortable ? (
                    <button type="button" className="web-th-sort" onClick={() => toggleSort(column)}>
                      {column.header}
                      {sorted ? <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            {hasActions ? (
              <th scope="col" className="web-th-actions">
                <span className="web-sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} aria-hidden="true">
                  {Array.from({ length: columnCount }).map((__, cell) => (
                    <td key={cell}>
                      <span className="web-skeleton-bar" />
                    </td>
                  ))}
                </tr>
              ))
            : pageRows.map((row) => {
                const clickable = Boolean(rowHref || onRowClick);
                const label = rowLabel?.(row) ?? "row";
                return (
                  <tr
                    key={getRowKey(row)}
                    data-attention={isAttention?.(row) ? "true" : undefined}
                    data-clickable={clickable ? "true" : undefined}
                    onClick={clickable ? (event) => onRowActivate(event, row) : undefined}
                  >
                    {columns.map((column) => {
                      let content = column.render(row);
                      if (column.primary && rowHref) {
                        content = (
                          <Link href={rowHref(row)} className="web-cell-link">
                            {content}
                          </Link>
                        );
                      } else if (column.primary && onRowClick) {
                        content = (
                          <button type="button" className="web-cell-link" onClick={() => onRowClick(row)}>
                            {content}
                          </button>
                        );
                      }
                      return (
                        <td
                          key={column.id}
                          data-numeric={column.align === "end" ? "true" : undefined}
                          data-id={column.mono ? "true" : undefined}
                        >
                          {content ?? "—"}
                        </td>
                      );
                    })}
                    {hasActions ? (
                      <td className="web-td-actions">
                        {(rowActions?.(row) ?? []).length > 0 ? (
                        <WebMenu
                          label={`Actions for ${label}`}
                          triggerClassName="web-btn web-btn-icon web-row-actions"
                          trigger={
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          }
                          items={rowActions?.(row) ?? []}
                        />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
        </tbody>
      </table>
      </div>

      {!loading && matchCount === 0 ? (
        <p className="web-table-empty">
          {emptyUnfiltered ? (
            <>
              No {noun} yet. {emptyAction}
            </>
          ) : (
            <>
              No {noun} match these filters.{" "}
              <button type="button" className="web-rail-link" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          )}
        </p>
      ) : null}

      {!loading && !maxRows && matchCount > pageSize ? (
        <div className="web-table-footer">
          <span>
            {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, matchCount)} of {matchCount}
          </span>
          <span className="web-table-footer-buttons">
            <WebButton size="sm" disabled={currentPage <= 1} onClick={() => url.set({ page: currentPage - 1 > 1 ? String(currentPage - 1) : "" })}>
              Previous
            </WebButton>
            <WebButton size="sm" disabled={currentPage >= pageCount} onClick={() => url.set({ page: String(currentPage + 1) })}>
              Next
            </WebButton>
          </span>
        </div>
      ) : null}
      </div>
  );

  if (!title) return <section className="web-card">{body}</section>;
  return (
    <WebCard title={title} meta={meta} action={headerAction}>
      {body}
    </WebCard>
  );
}

