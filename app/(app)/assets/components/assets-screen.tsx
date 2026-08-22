import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import { listAssets, type AssetRecord } from "../actions";
import { listClients, listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { AssetsFilters } from "./assets-filters";
import { AssetsTable } from "./assets-table";
import { AssetsViewSwitcher, type AssetsView } from "./assets-view-switcher";
import { CreateAssetButton } from "./create-asset-button";
import { AssetMapLoader, type MapPin } from "./asset-map-loader";

const LIST_PAGE_SIZE = 20;
const MAP_FETCH_LIMIT = 200;

export interface AssetsScreenProps {
  view: AssetsView;
  clientId?: string;
  siteId?: string;
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildPageHref(params: {
  view: AssetsView;
  clientId?: string;
  siteId?: string;
  page: number;
}): string {
  const qs = new URLSearchParams();
  qs.set("view", params.view);
  if (params.clientId) qs.set("clientId", params.clientId);
  if (params.siteId) qs.set("siteId", params.siteId);
  if (params.page > 0) qs.set("page", String(params.page));
  return `/assets?${qs.toString()}`;
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
      status: asset.status,
    };

    const existing = pinsBySite.get(site.id);
    if (existing) {
      existing.assets.push(pinAsset);
    } else {
      pinsBySite.set(site.id, {
        siteId: site.id,
        siteName: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        assets: [pinAsset],
      });
    }
  }

  return Array.from(pinsBySite.values());
}

/**
 * The data-fetching heart of the Assets module — rendered inside a
 * `Suspense` boundary by `app/(app)/assets/page.tsx` so its shaped skeleton
 * shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md).
 */
export async function AssetsScreen({
  view,
  clientId,
  siteId,
  page,
  canCreate,
  canEdit,
  canDelete,
}: AssetsScreenProps) {
  const isMapView = view === "map";
  const limit = isMapView ? MAP_FETCH_LIMIT : LIST_PAGE_SIZE;
  const offset = isMapView ? 0 : page * LIST_PAGE_SIZE;

  const [clientsResult, assetsResult, currentSitesResult] = await Promise.all([
    listClients({ limit: 200 }),
    listAssets({ clientId, siteId, limit, offset }),
    clientId ? listSites(clientId) : Promise.resolve(null),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const filterSites: SiteRecord[] = currentSitesResult?.data?.sites ?? [];

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <AssetsFilters clients={clients} sites={filterSites} selectedClientId={clientId} selectedSiteId={siteId} />
      </Toolbar.Section>
      <Toolbar.Section align="end">
        <AssetsViewSwitcher view={view} />
        {canCreate && <CreateAssetButton clients={clients} />}
      </Toolbar.Section>
    </Toolbar>
  );

  if (!assetsResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{assetsResult.error ?? "Could not load assets."}</Text>
        </Card>
      </>
    );
  }

  const { assets, count } = assetsResult.data;
  const hasFilters = Boolean(clientId || siteId);

  if (assets.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<Boxes />}
          heading={hasFilters ? "No assets match these filters" : "No assets yet"}
          text={
            hasFilters
              ? "Try a different client or site filter."
              : "Add your first piece of equipment to start tracking it."
          }
          action={canCreate && !hasFilters ? <CreateAssetButton clients={clients} /> : undefined}
        />
      </>
    );
  }

  if (isMapView) {
    const distinctClientIds = Array.from(new Set(assets.map((asset) => asset.client_id)));
    const siteListResults = await Promise.all(distinctClientIds.map((id) => listSites(id)));
    const sitesById = new Map<string, SiteRecord>();
    for (const result of siteListResults) {
      for (const site of result.data?.sites ?? []) {
        sitesById.set(site.id, site);
      }
    }

    const pins = buildMapPins(assets, sitesById, clientNameById);
    const plottedCount = pins.reduce((sum, pin) => sum + pin.assets.length, 0);
    const unplottedCount = assets.length - plottedCount;

    return (
      <>
        {toolbar}
        <AssetMapLoader pins={pins} />
        {unplottedCount > 0 && (
          <Text tone="muted">
            {unplottedCount} of {assets.length} asset{assets.length === 1 ? "" : "s"} shown here{" "}
            {assets.length === count ? "" : `(of ${count} total) `}
            {unplottedCount === 1 ? "has" : "have"} no site coordinates yet and can&rsquo;t be plotted.
          </Text>
        )}
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + assets.length < count;

  return (
    <>
      {toolbar}
      <AssetsTable
        assets={assets}
        clients={clients}
        clientNameById={clientNameById}
        canEdit={canEdit}
        canDelete={canDelete}
      />
      {/* `Toolbar` is the app shell's sticky top bar (see
          components/shell/topbar.tsx) — reusing it a second time here for a
          bottom pagination row would fight its own `position: sticky`.
          There's no plain horizontal-row primitive in the current
          `@yourorg/ui` stub for a case like this (flagged for the
          design-system repo); `Button` is `display: inline-flex` though, so
          two of them inside a bare `<span>` sit side by side via normal
          inline flow without any ad-hoc CSS. */}
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + assets.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref({ view, clientId, siteId, page: page - 1 })}>
              <Button type="button" variant="outline" size="sm">
                Previous
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}{" "}
          {hasNext ? (
            <Link href={buildPageHref({ view, clientId, siteId, page: page + 1 })}>
              <Button type="button" variant="outline" size="sm">
                Next
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </span>
      </Stack>
    </>
  );
}
