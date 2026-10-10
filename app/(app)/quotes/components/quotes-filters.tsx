"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect, type MultiSelectOption } from "@yourorg/ui";

export interface QuotesFiltersProps {
  statusOptions: MultiSelectOption[];
  typeOptions: MultiSelectOption[];
  /** Effective (URL-or-default) selections, resolved on the server. */
  selectedStatuses: string[];
  selectedTypes: string[];
}

/**
 * Status + Type multi-select filters for the Quotes overview (issues
 * #210/#211). State lives in the URL (`?status=draft,sent&type=default`) so
 * a filtered view is shareable and survives refresh; an absent param means
 * the default (Draft / Default). Toggles are kept locally while a popover is
 * open and committed as ONE navigation when it closes. Clearing a filter
 * entirely commits "all" (no filter), so the trigger never reads "None" while
 * rows are still showing.
 */
export function QuotesFilters({ statusOptions, typeOptions, selectedStatuses, selectedTypes }: QuotesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [statuses, setStatuses] = useState(selectedStatuses);
  const [types, setTypes] = useState(selectedTypes);

  // Resync when the URL-derived props change (back/forward navigation).
  const statusKey = selectedStatuses.join(",");
  const typeKey = selectedTypes.join(",");
  useEffect(() => setStatuses(selectedStatuses), [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setTypes(selectedTypes), [typeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(key: "status" | "type", value: string[], options: MultiSelectOption[], current: string[]) {
    const next = value.length === 0 ? options.map((option) => option.value) : value;
    if (key === "status") setStatuses(next);
    else setTypes(next);
    const sameAsCurrent = next.length === current.length && next.every((v) => current.includes(v));
    if (sameAsCurrent) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, next.join(","));
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <>
      {statusOptions.length > 0 && (
        <MultiSelect
          label="Status"
          options={statusOptions}
          value={statuses}
          onChange={setStatuses}
          onClose={() => commit("status", statuses, statusOptions, selectedStatuses)}
        />
      )}
      <MultiSelect
        label="Type"
        options={typeOptions}
        value={types}
        onChange={setTypes}
        onClose={() => commit("type", types, typeOptions, selectedTypes)}
      />
    </>
  );
}
