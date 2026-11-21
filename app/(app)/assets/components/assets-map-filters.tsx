"use client";

import { WebListFilterBar, type FilterOption } from "@yourorg/ui/web-client";
import { ASSETS_DROPDOWN_IDS, ASSETS_WARRANTY_SEGMENT } from "./assets-filter-defs";

/**
 * The FilterBar of the Assets map view: the same search / Client / Site /
 * Type / Status / warranty filters (and URL params) as the list table, so
 * switching view keeps the selection. Client resets Site; Site stays disabled
 * until a client is chosen.
 */
export function AssetsMapFilters({
  clientOptions,
  siteOptions,
  typeOptions,
  statusOptions,
  total,
  unfilteredTotal,
}: {
  clientOptions: FilterOption[];
  siteOptions: FilterOption[];
  typeOptions: FilterOption[];
  statusOptions: FilterOption[];
  total: number;
  unfilteredTotal?: number;
}) {
  return (
    <WebListFilterBar
      noun="assets"
      segment={ASSETS_WARRANTY_SEGMENT}
      toggle={{ id: "inactive", label: "Show inactive" }}
      total={total}
      unfilteredTotal={unfilteredTotal}
      dropdowns={[
        { id: ASSETS_DROPDOWN_IDS.client, label: "Client", options: clientOptions, resets: [ASSETS_DROPDOWN_IDS.site] },
        {
          id: ASSETS_DROPDOWN_IDS.site,
          label: "Site",
          options: siteOptions,
          disabledWhen: (values) => !values[ASSETS_DROPDOWN_IDS.client],
        },
        { id: ASSETS_DROPDOWN_IDS.type, label: "Type", options: typeOptions },
        { id: ASSETS_DROPDOWN_IDS.status, label: "Status", options: statusOptions },
      ]}
    />
  );
}
