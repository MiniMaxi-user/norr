"use client";

import { useMemo } from "react";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import type { ClientVolumeAssetRow, ClientVolumeTotal, ClientVolumeTotalsData } from "@/lib/asset-volumes/actions";
import { formatDateTimeWeb, formatNumberWeb } from "@/lib/format/web";

export interface VolumesPanelProps {
  data: ClientVolumeTotalsData;
}

const RECENT_DAYS = 30;

/** Segment shared by both tables: how recently the counter was read. */
function useRecencySegment<T>(getReadAt: (row: T) => string | null) {
  return useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const recent = (row: T) => {
      const readAt = getReadAt(row);
      return readAt ? new Date(readAt).getTime() >= cutoff : false;
    };
    return {
      label: "Show readings by age",
      defaultValue: "all",
      options: [
        { value: "recent", label: `Last ${RECENT_DAYS} days`, match: recent },
        { value: "older", label: "Older", match: (row: T) => !recent(row) },
        { value: "all", label: "All" },
      ] as const,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Client "Volumes" tab (issue #221, restyled issue #222): two tables with an
 * identical structure — each in its own card (title + mono meta) with its own
 * FilterBar: the total per counter (sum of every asset's latest reading) and
 * the latest reading per asset, linking to the asset's own Volumes tab.
 * Read-only: readings are recorded on the asset, so there is no add button.
 */
export function VolumesPanel({ data }: VolumesPanelProps) {
  const totalsSegment = useRecencySegment<ClientVolumeTotal>((total) => total.lastReadAt);
  const rowsSegment = useRecencySegment<ClientVolumeAssetRow>((row) => row.readAt);

  const totalColumns = useMemo<WebColumn<ClientVolumeTotal>[]>(
    () => [
      { id: "counter", header: "Counter", sortValue: (total) => total.label, render: (total) => total.label },
      {
        id: "total",
        header: "Total",
        align: "end",
        sortValue: (total) => total.total,
        render: (total) => `${formatNumberWeb(total.total)}${total.unitLabel ? ` ${total.unitLabel}` : ""}`,
      },
      { id: "assets", header: "Assets", align: "end", sortValue: (total) => total.assetCount, render: (total) => total.assetCount },
      {
        id: "lastRead",
        header: "Last read",
        sortValue: (total) => total.lastReadAt,
        render: (total) => formatDateTimeWeb(total.lastReadAt),
      },
    ],
    [],
  );

  const rowColumns = useMemo<WebColumn<ClientVolumeAssetRow>[]>(
    () => [
      {
        id: "asset",
        header: "Asset",
        primary: true,
        sortValue: (row) => row.assetName,
        render: (row) => row.assetName,
      },
      { id: "site", header: "Site", sortValue: (row) => row.siteName ?? "", render: (row) => row.siteName ?? "—" },
      { id: "counter", header: "Counter", sortValue: (row) => row.counterLabel, render: (row) => row.counterLabel },
      { id: "value", header: "Latest value", align: "end", sortValue: (row) => row.value, render: (row) => formatNumberWeb(row.value) },
      { id: "readAt", header: "Read at", sortValue: (row) => row.readAt, render: (row) => formatDateTimeWeb(row.readAt) },
    ],
    [],
  );

  const totalDropdowns = useMemo(
    () => [
      {
        id: "unit",
        label: "Unit",
        getOptions: (total: ClientVolumeTotal) =>
          total.unitLabel ? [{ value: total.unitLabel, label: total.unitLabel }] : [],
      },
    ],
    [],
  );
  const rowDropdowns = useMemo(
    () => [
      {
        id: "counter",
        label: "Counter",
        getOptions: (row: ClientVolumeAssetRow) => [{ value: row.volumeItemId, label: row.counterLabel }],
      },
      {
        id: "site",
        label: "Site",
        getOptions: (row: ClientVolumeAssetRow) => (row.siteId && row.siteName ? [{ value: row.siteId, label: row.siteName }] : []),
      },
    ],
    [],
  );

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Totals per counter"
        meta={String(data.totals.length)}
        rows={data.totals}
        getRowKey={(total) => total.volumeItemId}
        columns={totalColumns}
        searchText={(total) => `${total.label} ${total.unitLabel ?? ""}`}
        noun="counters"
        dropdowns={totalDropdowns}
        segment={totalsSegment}
        urlPrefix="vtotals"
        defaultSort={{ columnId: "counter", direction: "asc" }}
        rowLabel={(total) => total.label}
        emptyAction="Readings recorded on this client's assets are summarized here."
      />
      <WebDataTableCard
        title="Latest reading per asset"
        meta={String(data.rows.length)}
        rows={data.rows}
        getRowKey={(row) => `${row.assetId}-${row.volumeItemId}`}
        columns={rowColumns}
        searchText={(row) => `${row.assetName} ${row.siteName ?? ""} ${row.counterLabel}`}
        noun="readings"
        dropdowns={rowDropdowns}
        segment={rowsSegment}
        urlPrefix="vreadings"
        searchShortcut={false}
        defaultSort={{ columnId: "counter", direction: "asc" }}
        rowHref={(row) => `/assets/${row.assetId}?tab=volumes`}
        rowLabel={(row) => row.assetName}
      />
    </div>
  );
}
