"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { scrollMainToTop } from "./scroll";

export interface WebQuickFilter {
  key: string;
  /** Count + what needs attention: "1 in repair", "4 warranty expired". */
  label: string;
  /** attention = filled gold, danger = filled red, neutral = dark pill. At
   * most two filled ones are shown filled; the rest render neutral. */
  tone: "attention" | "danger" | "neutral";
  /** URL params this badge sets in the FilterBar (`{ status: "<id>" }`,
   * `{ seg: "expired" }`). Active when all of them match the URL. */
  params: Record<string, string>;
}

const MAX_QUICK_FILTERS = 3;
const MAX_FILLED = 2;

/**
 * Attention badges under the title of an overview page (DS 06 §1) that work
 * as quick filters: a click sets the matching FilterBar filter(s) in the URL
 * (back to page 1, centre to the top); clicking the active one removes them.
 * Real `<button aria-pressed>`s. Render nothing when nothing needs attention.
 */
export function WebQuickFilters({ filters, label = "Needs attention" }: { filters: WebQuickFilter[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const visible = filters.slice(0, MAX_QUICK_FILTERS);
  if (visible.length === 0) return null;

  let filled = 0;
  return (
    <div className="web-quick-filters" role="group" aria-label={label}>
      {visible.map((filter) => {
        const active = Object.entries(filter.params).every(([key, value]) => searchParams.get(key) === value);
        let variant: "attention" | "danger" | "neutral" = filter.tone;
        if (variant !== "neutral") {
          filled += 1;
          if (filled > MAX_FILLED) variant = "neutral";
        }
        return (
          <button
            key={filter.key}
            type="button"
            className="web-badge web-quick-filter"
            data-variant={variant}
            aria-pressed={active}
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString());
              for (const [key, value] of Object.entries(filter.params)) {
                if (active) next.delete(key);
                else next.set(key, value);
              }
              next.delete("page");
              const query = next.toString();
              startTransition(() => {
                router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
              });
              scrollMainToTop();
            }}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
