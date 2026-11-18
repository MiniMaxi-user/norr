import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
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
  const header = { module: "Assets", title: "Assets", count: unfilteredCount ?? count, actions, primary };

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
