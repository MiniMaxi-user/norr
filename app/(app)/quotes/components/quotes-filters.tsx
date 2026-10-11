"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Inline, Text, type MultiSelectOption } from "@yourorg/ui";

export interface QuotesFiltersProps {
  statusOptions: MultiSelectOption[];
  typeOptions: MultiSelectOption[];
  /** Effective (URL-or-default) selections, resolved on the server. */
  selectedStatuses: string[];
  selectedTypes: string[];
}

/**
 * Status + Type toggle-button filters for the Quotes overview (issues
 * #210/#211). Each option is a pressed/unpressed button, so switching needs
 * one click instead of opening a dropdown (same toggle pattern as the
 * planning backlog's `FilterPill`). State lives in the URL
 * (`?status=draft,invoiced&type=default`) so a filtered view is shareable and
 * survives refresh; an absent param means the default (Draft / Default).
 * Every click navigates immediately. At least one option per filter stays
 * pressed (un-pressing the last one is a no-op), so the list never reads as
 * "nothing selected" while rows are showing.
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

  function toggle(key: "status" | "type", value: string, current: string[]) {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length === 0) return;
    if (key === "status") setStatuses(next);
    else setTypes(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, next.join(","));
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <>
      {statusOptions.length > 0 && (
        <ToggleGroup
          label="Status"
          options={statusOptions}
          selected={statuses}
          onToggle={(value) => toggle("status", value, statuses)}
        />
      )}
      <ToggleGroup label="Type" options={typeOptions} selected={types} onToggle={(value) => toggle("type", value, types)} />
    </>
  );
}

function ToggleGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <Inline gap="xs" align="center" wrap role="group" aria-label={`${label} filter`}>
      <Text tone="muted">{label}</Text>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active ? "primary" : "outline"}
            aria-pressed={active}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </Inline>
  );
}
