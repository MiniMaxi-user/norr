"use client";
// URL-driven FilterBar for a list page's non-table view (a map, a board whose
// data is fetched by the server). Same params and behaviour as
// `WebDataTableCard`'s server mode, minus the table. Part of the `web-client`
// entry.

import { useEffect, useState } from "react";
import { FilterBar, useServerParams, type FilterOption, type WebDropdownDef, type WebSegmentDef } from "./data-table";

export interface WebListFilterBarProps {
  /** Plural noun for the placeholder: "assets". */
  noun: string;
  dropdowns: Pick<WebDropdownDef<unknown>, "id" | "label" | "options" | "resets" | "disabledWhen">[];
  segment: Pick<WebSegmentDef<unknown>, "label" | "defaultValue"> & {
    options: readonly [FilterOption, FilterOption, FilterOption];
  };
  /** Rows matching the current filters / rows before the filters. */
  total: number;
  unfilteredTotal?: number;
}

/**
 * The FilterBar of a server-driven list page whose body is not a table.
 * Search (debounced 250 ms), dropdowns, segment and "Clear filters" write the
 * plain `q` / `seg` / `<dropdown id>` URL params (`router.replace` in a
 * transition, page reset) that the Server Component reads.
 */
export function WebListFilterBar({ noun, dropdowns, segment, total, unfilteredTotal }: WebListFilterBarProps) {
  const url = useServerParams(true);
  const q = url.get("q");
  const segValue = url.get("seg") || segment.defaultValue;
  const values = Object.fromEntries(dropdowns.map((dropdown) => [dropdown.id, url.get(dropdown.id)]));

  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return undefined;
    const timer = setTimeout(() => url.set({ q: searchInput, page: "" }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const filtersActive = Boolean(q) || segValue !== segment.defaultValue || Object.values(values).some(Boolean);

  return (
    <FilterBar
      searchValue={searchInput}
      onSearchChange={setSearchInput}
      searchPlaceholder={`Search ${noun}…`}
      dropdowns={dropdowns.map((dropdown) => ({
        id: dropdown.id,
        label: dropdown.label,
        value: values[dropdown.id] ?? "",
        options: dropdown.options ?? [],
        disabled: dropdown.disabledWhen?.(values),
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
      shownCount={total}
      totalCount={unfilteredTotal ?? total}
      filtersActive={filtersActive}
      onClear={() => {
        setSearchInput("");
        url.set({
          q: "",
          seg: "",
          page: "",
          ...Object.fromEntries(dropdowns.map((dropdown) => [dropdown.id, ""])),
        });
      }}
    />
  );
}
