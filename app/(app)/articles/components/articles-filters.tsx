"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input, Select } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Filter bar for the Articles list (issue #92): text search (article number/
 * description/EAN/GTIN/MPN, server-side via `listArticles({ search })`) plus
 * Group/Manufacturer/Active/Composite selects — every filter narrows the
 * server-side query by pushing updated search params, same pattern
 * `AssetsFilters` uses for its own client/site selects. The Suspense
 * boundary around `ArticlesScreen` (see `app/(app)/articles/page.tsx`)
 * re-fetches and shows the shaped skeleton while a new filter applies.
 *
 * Unlike `AssetsFilters` (immediate-on-change selects only), the search
 * field debounces its own navigation — a real server round trip per
 * keystroke would otherwise fire the Suspense skeleton on every character.
 */
export function ArticlesFilters({
  groups,
  manufacturers,
  search,
  groupId,
  manufacturerItemId,
  active,
  composite,
}: {
  groups: FlattenedArticleGroup[];
  manufacturers: ReferenceListItemRecord[];
  search?: string;
  groupId?: string;
  manufacturerItemId?: string;
  active?: string;
  composite?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchValue, setSearchValue] = useState(search ?? "");

  // Keeps the field in sync with the URL when a filter change elsewhere
  // (e.g. clearing all filters) resets `search` out from under this local
  // draft — mirrors `Combobox`'s own "sync from the outside value" effect.
  useEffect(() => {
    setSearchValue(search ?? "");
  }, [search]);

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed === (search ?? "")) return;
    const timeout = setTimeout(() => navigate({ search: trimmed || undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  return (
    <>
      <Input
        aria-label="Search articles"
        placeholder="Search by article number, description, EAN, GTIN, MPN…"
        value={searchValue}
        onChange={(event) => setSearchValue(event.target.value)}
      />

      <Select
        aria-label="Filter by group"
        value={groupId ?? ""}
        onChange={(event) => navigate({ groupId: event.target.value || undefined })}
      >
        <option value="">All groups</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.path}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by manufacturer"
        value={manufacturerItemId ?? ""}
        onChange={(event) => navigate({ manufacturerItemId: event.target.value || undefined })}
      >
        <option value="">All manufacturers</option>
        {manufacturers.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Filter by status" value={active ?? ""} onChange={(event) => navigate({ active: event.target.value || undefined })}>
        <option value="">All statuses</option>
        <option value="1">Active only</option>
        <option value="0">Inactive only</option>
      </Select>

      <Select
        aria-label="Filter by composite"
        value={composite ?? ""}
        onChange={(event) => navigate({ composite: event.target.value || undefined })}
      >
        <option value="">Composite &amp; plain</option>
        <option value="1">Composite only</option>
        <option value="0">Plain only</option>
      </Select>
    </>
  );
}
