"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  StatusText,
  WebDataTableCard,
  toneFromColor,
  type FilterOption,
  type WebColumn,
} from "@yourorg/ui/web-client";
import { formatDateWeb } from "@/lib/format/web";
import type { AssetRecord } from "../actions";
import { ASSETS_PAGE_SIZE } from "./assets-query";
import { DeleteAssetDialog } from "./delete-asset-dialog";
import { ASSETS_DROPDOWN_IDS, ASSETS_WARRANTY_SEGMENT } from "./assets-filter-defs";

/** Client reference cell: a link in `text-link` (DS: clickable = coloured). */
function clientLink(clientId: string | null | undefined, name: string | undefined) {
  return clientId && name ? <Link href={`/clients/${clientId}`}>{name}</Link> : null;
}

export interface AssetsTableProps {
  assets: AssetRecord[];
  clientNameById: Map<string, string>;
  /** Filter choices (see `assets-filter-defs.ts`). */
  clientOptions: FilterOption[];
  siteOptions: FilterOption[];
  typeOptions: FilterOption[];
  statusOptions: FilterOption[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Assets list table (list-page shell, issue #222): a `WebDataTableCard` in
 * server mode. `listAssets` (driven by the URL params `q`, `clientId`,
 * `siteId`, `type`, `status`, `seg`, `sort`, `dir`, `page`) returns the
 * filtered page; this component renders it. A row (or the Name link) opens
 * the asset's detail page. One ··· menu per row: Open, Edit (with edit
 * rights) and Delete (with delete rights, confirmed in `DeleteAssetDialog`).
 */
export function AssetsTable({
  assets,
  clientNameById,
  clientOptions,
  siteOptions,
  typeOptions,
  statusOptions,
  total,
  unfilteredTotal,
  page,
  canCreate,
  canEdit,
  canDelete,
}: AssetsTableProps) {
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);

  const columns = useMemo<WebColumn<AssetRecord>[]>(
    () => [
      { id: "name", header: "Name", primary: true, sortable: true, render: (asset) => asset.name },
      { id: "type", header: "Type", render: (asset) => asset.asset_type?.label ?? null },
      { id: "client", header: "Client", render: (asset) => clientLink(asset.client_id, clientNameById.get(asset.client_id)) },
      { id: "serial", header: "Serial number", mono: true, sortable: true, render: (asset) => asset.serial_number },
      {
        id: "status",
        header: "Status",
        render: (asset) =>
          asset.asset_status ? (
            <StatusText display="auto" tone={toneFromColor(asset.asset_status.color)}>{asset.asset_status.label}</StatusText>
          ) : null,
      },
      {
        id: "warranty",
        header: "Warranty until",
        sortable: true,
        render: (asset) => (asset.warranty_until ? formatDateWeb(asset.warranty_until) : null),
      },
    ],
    [clientNameById],
  );

  const dropdowns = useMemo(
    () => [
      { id: ASSETS_DROPDOWN_IDS.client, label: "Client", options: clientOptions, resets: [ASSETS_DROPDOWN_IDS.site] },
      {
        id: ASSETS_DROPDOWN_IDS.site,
        label: "Site",
        options: siteOptions,
        disabledWhen: (values: Record<string, string>) => !values[ASSETS_DROPDOWN_IDS.client],
      },
      { id: ASSETS_DROPDOWN_IDS.type, label: "Type", options: typeOptions },
      { id: ASSETS_DROPDOWN_IDS.status, label: "Status", options: statusOptions },
    ],
    [clientOptions, siteOptions, typeOptions, statusOptions],
  );

  return (
    <>
      <WebDataTableCard<AssetRecord>
        rows={assets}
        getRowKey={(asset) => asset.id}
        columns={columns}
        noun="assets"
        dropdowns={dropdowns}
        segment={ASSETS_WARRANTY_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: ASSETS_PAGE_SIZE }}
        defaultSort={{ columnId: "name", direction: "asc" }}
        rowHref={(asset) => `/assets/${asset.id}`}
        rowLabel={(asset) => asset.name}
        rowActions={(asset) => [
          { key: "open", label: "Open", href: `/assets/${asset.id}` },
          ...(canEdit ? [{ key: "edit", label: "Edit", href: `/assets/${asset.id}/edit` }] : []),
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeletingAsset(asset) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/assets/new" className="web-rail-link">
              Create asset
            </Link>
          ) : null
        }
      />
      {deletingAsset ? (
        <DeleteAssetDialog asset={deletingAsset} open onOpenChange={(next) => !next && setDeletingAsset(null)} />
      ) : null}
    </>
  );
}
