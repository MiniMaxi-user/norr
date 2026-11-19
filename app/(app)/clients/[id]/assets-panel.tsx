"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StatusText,
  WebDataTableCard,
  toneFromColor,
  type WebColumn,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { CreateAssetButton } from "@/app/(app)/assets/components/create-asset-button";
import { DeleteAssetDialog } from "@/app/(app)/assets/components/delete-asset-dialog";
import type { SiteRecord } from "../actions";
import { formatSiteAddressShort } from "../format-site-address";

export interface AssetsPanelProps {
  clientId: string;
  sites: SiteRecord[];
  assets: AssetRecord[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Set (and bumped via `focusToken`, since the same site can be re-picked
   * twice in a row) by the Sites tab's asset count link — applies the Site
   * filter of this table. `null`/unchanged otherwise. */
  focusSiteId: string | null;
  focusToken: number;
}

/**
 * Assets tab (design-system table pattern, issue #222): every asset across
 * this client's sites in ONE card with a FilterBar. The client → site → asset
 * hierarchy stays visible through the Site column and Site filter (previously
 * one disclosure group per site); the Sites tab's asset count jumps here with
 * that site's filter applied (`assets_site` URL param). Edit/Delete moved into
 * the row ··· menu.
 */
export function AssetsPanel({
  clientId,
  sites,
  assets,
  canCreate,
  canEdit,
  canDelete,
  focusSiteId,
  focusToken,
}: AssetsPanelProps) {
  const [deleting, setDeleting] = useState<AssetRecord | null>(null);

  const siteLabelById = useMemo(
    () => new Map(sites.map((site) => [site.id, formatSiteAddressShort(site) ?? "Unnamed site"] as const)),
    [sites],
  );

  // Cross-tab jump from the Sites tab: apply the Site filter via the URL
  // (`useSearchParams` follows `history.replaceState`).
  useEffect(() => {
    if (!focusSiteId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("assets_site", focusSiteId);
    url.searchParams.delete("assets_page");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [focusSiteId, focusToken]);

  const assetHref = (asset: AssetRecord) => (canEdit ? `/assets/${asset.id}/edit` : `/assets/${asset.id}`);

  const columns = useMemo<WebColumn<AssetRecord>[]>(
    () => [
      { id: "name", header: "Name", primary: true, sortValue: (asset) => asset.name, render: (asset) => asset.name },
      {
        id: "site",
        header: "Site",
        sortValue: (asset) => siteLabelById.get(asset.site_id) ?? "",
        render: (asset) => siteLabelById.get(asset.site_id) ?? "—",
      },
      {
        id: "type",
        header: "Type",
        sortValue: (asset) => asset.asset_type?.label ?? "",
        render: (asset) => asset.asset_type?.label ?? "—",
      },
      {
        id: "serial",
        header: "Serial number",
        mono: true,
        sortValue: (asset) => asset.serial_number ?? "",
        render: (asset) => asset.serial_number ?? "—",
      },
      {
        id: "status",
        header: "Status",
        sortValue: (asset) => asset.asset_status?.label ?? "",
        render: (asset) =>
          asset.asset_status ? (
            <StatusText display="auto" tone={toneFromColor(asset.asset_status.color)}>{asset.asset_status.label}</StatusText>
          ) : (
            "—"
          ),
      },
    ],
    [siteLabelById],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "site",
        label: "Site",
        getOptions: (asset: AssetRecord) => [
          { value: asset.site_id, label: siteLabelById.get(asset.site_id) ?? "Unnamed site" },
        ],
      },
      {
        id: "type",
        label: "Type",
        getOptions: (asset: AssetRecord) =>
          asset.asset_type ? [{ value: asset.asset_type.value, label: asset.asset_type.label }] : [],
      },
      {
        id: "status",
        label: "Status",
        getOptions: (asset: AssetRecord) =>
          asset.asset_status ? [{ value: asset.asset_status.value, label: asset.asset_status.label }] : [],
      },
    ],
    [siteLabelById],
  );

  const segment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const inWarranty = (asset: AssetRecord) => Boolean(asset.warranty_until && asset.warranty_until >= today);
    return {
      label: "Show assets by warranty",
      defaultValue: "all",
      options: [
        { value: "in", label: "In warranty", match: inWarranty },
        { value: "out", label: "Out of warranty", match: (asset: AssetRecord) => !inWarranty(asset) },
        { value: "all", label: "All" },
      ] as const,
    };
  }, []);

  function rowActions(asset: AssetRecord): WebMenuItem[] {
    const items: WebMenuItem[] = [
      { key: "open", label: canEdit ? "Edit asset" : "Open asset", href: assetHref(asset) },
    ];
    if (canDelete) items.push({ key: "delete", label: "Delete asset", danger: true, onSelect: () => setDeleting(asset) });
    return items;
  }

  return (
    <>
      <WebDataTableCard
        title="Assets"
        meta={String(assets.length)}
        rows={assets}
        getRowKey={(asset) => asset.id}
        columns={columns}
        searchText={(asset) =>
          [asset.name, asset.serial_number, asset.external_reference, asset.asset_type?.label, siteLabelById.get(asset.site_id)]
            .filter(Boolean)
            .join(" ")
        }
        noun="assets"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="assets"
        defaultSort={{ columnId: "name", direction: "asc" }}
        rowHref={assetHref}
        rowActions={rowActions}
        rowLabel={(asset) => asset.name}
        add={canCreate && sites.length > 0 ? <CreateAssetButton clientId={clientId} label="+ Asset" filterBar /> : undefined}
        emptyAction={
          sites.length === 0
            ? "Assets attach to a site — add a site on the Sites tab first."
            : canCreate
              ? "Use + Asset to add this client's first piece of equipment."
              : undefined
        }
      />
      {deleting && <DeleteAssetDialog asset={deleting} open onOpenChange={(next) => !next && setDeleting(null)} />}
    </>
  );
}
