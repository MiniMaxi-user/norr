import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage, toneFromColor } from "@yourorg/ui/web";
import { WebQuickFilters, type WebQuickFilter } from "@yourorg/ui/web-client";
import { listAssets, type AssetRecord } from "../actions";
import {
  listClients,
  listSites,
  listSitesForClientIds,
  type ClientRecord,
  type SiteRecord,
} from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { AssetMapLoader, type MapPin } from "./asset-map-loader";
import { AssetsMapFilters } from "./assets-map-filters";
import { parseAssetsQuery, type AssetsSearchParams } from "./assets-query";
import { AssetsTable } from "./assets-table";
import { AssetsViewSwitcher, type AssetsView } from "./assets-view-switcher";

const MAP_FETCH_LIMIT = 200;

export interface AssetsScreenProps {
  view: AssetsView;
  params: AssetsSearchParams;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildMapPins(assets: AssetRecord[], sitesById: Map<string, SiteRecord>, clientNameById: Map<string, string>): MapPin[] {
  const pinsBySite = new Map<string, MapPin>();

  for (const asset of assets) {
    const site = sitesById.get(asset.site_id);
    if (!site || site.latitude == null || site.longitude == null) continue;

    const pinAsset = {
      id: asset.id,
      name: asset.name,
      clientName: clientNameById.get(asset.client_id) ?? "Unknown client",
      status: asset.asset_status,
    };

    const existing = pinsBySite.get(site.id);
    if (existing) {
      existing.assets.push(pinAsset);
    } else {
      pinsBySite.set(site.id, {
        siteId: site.id,
        siteLabel: formatSiteAddressShort(site) ?? "Unnamed site",
        latitude: site.latitude,
        longitude: site.longitude,
        assets: [pinAsset],
      });
    }
  }

  return Array.from(pinsBySite.values());
}

/** Distinct `value`/`label` pairs of one embedded reference item over the
 * given assets: the fallback filter choices when the picklist itself cannot
 * be read (it needs settings access). */
function optionsFromAssets(assets: AssetRecord[], pick: (asset: AssetRecord) => { id: string; label: string } | null) {
  const seen = new Map<string, string>();
  for (const asset of assets) {
    const item = pick(asset);
    if (item && !seen.has(item.id)) seen.set(item.id, item.label);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

/**
 * Attention badges of the overview header (DS 06 §1), each a quick filter on
 * the existing URL filters: assets in a deviating status (a gold or red
 * status in the tenant's status list, e.g. "In repair") and assets whose
 * warranty has expired. Counts are module-wide (not narrowed by the current
 * filters); zero counts are left out, max 3.
 */
async function loadAssetQuickFilters(
  statuses: { id: string; label: string; color: string | null }[],
): Promise<WebQuickFilter[]> {
  const deviating = statuses
    .map((status) => ({ status, tone: toneFromColor(status.color) }))
    .filter(({ tone }) => tone === "warning" || tone === "danger")
    .slice(0, 2);

  const [statusCounts, expired] = await Promise.all([
    Promise.all(deviating.map(({ status }) => listAssets({ statusId: status.id, limit: 1 }))),
    listAssets({ warranty: "expired", limit: 1 }),
  ]);

  const filters: WebQuickFilter[] = [];
  deviating.forEach(({ status, tone }, index) => {
    const total = statusCounts[index]?.data?.count ?? 0;
    if (total > 0) {
      filters.push({
        key: `status-${status.id}`,
        label: `${total} ${status.label.toLowerCase()}`,
        tone: tone === "danger" ? "danger" : "attention",
        params: { status: status.id },
      });
    }
  });
  const expiredCount = expired.data?.count ?? 0;
  if (expiredCount > 0) {
    filters.push({
      key: "warranty-expired",
      label: `${expiredCount} warranty expired`,
      tone: "danger",
      params: { seg: "expired" },
    });
  }
  return filters.slice(0, 3);
}

/**
 * The data-fetching heart of the Assets module — rendered inside a
 * `Suspense` boundary by `app/(app)/assets/page.tsx` (fallback
 * `WebListSkeleton`, route-level streaming per docs/ARCHITECTURE.md). Renders
 * the list-page shell (`WebListPage`): header with count, view switcher and
 * the navy "New asset" button, then either the server-driven table or the map.
 * List and map share the URL filters (`q`, `clientId`, `siteId`, `type`,
 * `status`, `seg`), applied server-side by `listAssets`.
 */
export async function AssetsScreen({ view, params, canCreate, canEdit, canDelete }: AssetsScreenProps) {
  const isMapView = view === "map";
  const { page, options } = parseAssetsQuery(params);
  const listOptions = isMapView ? { ...options, limit: MAP_FETCH_LIMIT, offset: 0 } : options;

  const [clientsResult, assetsResult, currentSitesResult, typesResult, statusesResult] = await Promise.all([
    listClients({ limit: 200 }),
    listAssets(listOptions),
    params.clientId ? listSites(params.clientId) : Promise.resolve(null),
    listReferenceItems("asset_type"),
    listReferenceItems("asset_status"),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));
  const siteOptions = (currentSitesResult?.data?.sites ?? []).map((site) => ({
    value: site.id,
    label: formatSiteAddressShort(site) ?? "Unnamed site",
  }));

  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/assets/new">
      New asset
    </WebLinkButton>
  ) : undefined;
  const actions = <AssetsViewSwitcher view={view} />;

  if (!assetsResult.data) {
    return (
      <WebListPage module="Assets" title="Assets" actions={actions} primary={primary}>
        <WebCard title="Assets">
          <WebDataTableEmpty>{assetsResult.error ?? "Could not load assets."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { assets, count, unfilteredCount } = assetsResult.data;

  const typeOptions = typesResult.data
    ? typesResult.data.items.map((item) => ({ value: item.id, label: item.label }))
    : optionsFromAssets(assets, (asset) => (asset.asset_type ? { id: asset.type_id, label: asset.asset_type.label } : null));
  const statusOptions = statusesResult.data
    ? statusesResult.data.items.map((item) => ({ value: item.id, label: item.label }))
    : optionsFromAssets(assets, (asset) => (asset.asset_status ? { id: asset.status_id, label: asset.asset_status.label } : null));

  const filterOptions = { clientOptions, siteOptions, typeOptions, statusOptions };
  const quickFilters = await loadAssetQuickFilters(statusesResult.data?.items ?? []);
  const header = {
    module: "Assets",
    title: "Assets",
    count: unfilteredCount ?? count,
    quickFilters: quickFilters.length > 0 ? <WebQuickFilters filters={quickFilters} /> : undefined,
    actions,
    primary,
  };

  if (isMapView) {
    const distinctClientIds = Array.from(new Set(assets.map((asset) => asset.client_id)));
    const siteListResult = distinctClientIds.length > 0 ? await listSitesForClientIds(distinctClientIds) : null;
    const sitesById = new Map<string, SiteRecord>();
    for (const site of siteListResult?.data?.sites ?? []) {
      sitesById.set(site.id, site);
    }

    const pins = buildMapPins(assets, sitesById, clientNameById);
    const plottedCount = pins.reduce((sum, pin) => sum + pin.assets.length, 0);
    const unplottedCount = assets.length - plottedCount;
    const truncated = assets.length < count ? ` · showing ${assets.length} of ${count}` : "";

    return (
      <WebListPage {...header}>
        <WebCard
          title="Map"
          meta={`${plottedCount} plotted${unplottedCount > 0 ? ` · ${unplottedCount} without site coordinates` : ""}${truncated}`}
        >
          <AssetsMapFilters {...filterOptions} total={count} unfilteredTotal={unfilteredCount} />
          {assets.length === 0 ? (
            <WebDataTableEmpty>
              {unfilteredCount === undefined ? "No assets yet." : "No assets match these filters."}
            </WebDataTableEmpty>
          ) : (
            <AssetMapLoader pins={pins} />
          )}
        </WebCard>
      </WebListPage>
    );
  }

  return (
    <WebListPage {...header}>
      <AssetsTable
        assets={assets}
        clientNameById={clientNameById}
        {...filterOptions}
        total={count}
        unfilteredTotal={unfilteredCount}
        page={page}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </WebListPage>
  );
}
