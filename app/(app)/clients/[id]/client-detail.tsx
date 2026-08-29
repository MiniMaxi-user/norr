"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DefinitionList,
  DetailHero,
  DetailLayout,
  Dialog,
  Heading,
  Inline,
  Separator,
  Stack,
  Tabs,
  Text,
} from "@yourorg/ui";
import { Bell, Boxes, ClipboardList, FileText, MapPin, Receipt, Settings, ShieldCheck, Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { activateAsTenant, type ClientRecord, type SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import { setTenantActive, type TenantAccessStatus } from "../platform-access-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ActivitiesPanel } from "./activities-panel";
import { DeleteClientDialog } from "../components/delete-client-dialog";
import { EditClientPanel } from "../components/edit-client-panel";
import { formatSiteAddress, formatSiteAddressShort } from "../format-site-address";
import { setLastUsedView } from "@/lib/preferences/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { AccessPanel } from "./access-panel";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { ContactsPanel } from "./contacts-panel";
import { ContractsPanel } from "./contracts-panel";
import { ModulesPanel } from "./modules-panel";
import { QuotesPanel } from "./quotes-panel";
import { SiteMapLoader, type SiteMapPin } from "./site-map-loader";
import { SitesPanel } from "./sites-panel";
import { WorkOrdersPanel } from "./work-orders-panel";

export type ClientDetailTab =
  | "sites"
  | "assets"
  | "contacts"
  | "workOrders"
  | "contracts"
  | "quotes"
  | "activities"
  | "access"
  | "modules";

export interface ClientDetailProps {
  client: ClientRecord;
  sites: SiteRecord[];
  canWrite: boolean;
  assets: AssetRecord[];
  assetsEnabled: boolean;
  canCreateAssets: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  contacts: ContactRecord[];
  contactRoles: ReferenceListItemRecord[];
  workOrders: WorkOrderRecord[];
  workOrdersEnabled: boolean;
  contracts: ContractRecord[];
  contractsEnabled: boolean;
  quotes: QuoteRecord[];
  quotesEnabled: boolean;
  activities: ActivityRecord[];
  activitiesEnabled: boolean;
  canCreateActivities: boolean;
  canEditActivities: boolean;
  canDeleteActivities: boolean;
  /** Threaded into `ActivitiesPanel` -> `ActivityQuickViewDialog`'s "Create
   * work order" action (issue #87) — `hasFeature(org, "planning")` +
   * `canAccessModule`/`can(actor, "planning", "create")`, resolved once by
   * `page.tsx`, independent of `activitiesEnabled` (a "Create work order"
   * action reads as a Planning affordance, not an Activities one). */
  canCreateWorkOrder: boolean;
  /** `session.isPlatformAdmin` (issue #45), threaded down the same way
   * `canWrite` etc. already are — gates the "Activate as tenant" hero action
   * and the "Access"/"Modules" tabs below. */
  isPlatformAdmin: boolean;
  /** Each of `contacts`' current tenant login-access status, keyed by
   * `email.trim().toLowerCase()` — only ever fetched (non-`null`) server-side
   * in `page.tsx` when the "Access" tab is actually visible
   * (`isPlatformAdmin && client.represents_organization_id`); `null`
   * otherwise, in which case the tab itself doesn't render either. */
  accessStatusByEmail: Record<string, TenantAccessStatus> | null;
  defaultTab: ClientDetailTab;
  /** Fetched once in `page.tsx`, passed down — populates `EditClientPanel`'s
   * "Account manager" `<Select>` (issue #58), same as `clients-board.tsx` ->
   * `ClientsExplorer` -> `EditClientPanel` on the list/kanban screen. */
  accountManagers: AccountManagerRecord[];
}

/**
 * Client detail: the client's own fields, plus its Sites and Assets shown
 * together on one page via `Tabs` instead of siloed screens (the "ik
 * verwacht dat je bij clients gelijk ook de assets kan zien" requirement).
 * The two tabs aren't just glued side by side — a site row's "Assets" count
 * (`SitesPanel`) jumps straight to that site's expanded group in the Assets
 * tab (`AssetsPanel`, grouped by site via `Disclosure`), so the real
 * client -> sites -> assets hierarchy stays visible from either tab instead
 * of being flattened into one generic list.
 *
 * The breadcrumb still lives in the Topbar (`usePageHeader`, see
 * `components/shell/page-header-context.tsx`). The client's own fields are
 * the "Option C" editorial `DetailHero` (`@yourorg/ui`) — an initials hero
 * mark, the client's name as the page's serif `Heading level={1}`, a
 * dot-separated primary-address meta line, and "Primary"/"Client since"
 * badges — the now-canonical header pattern for a top-level entity's detail
 * page (see `stories/EditorialDetailPage.stories.tsx` and
 * docs/ARCHITECTURE.md's "Relational detail pages" section).
 *
 * Below the hero, `<Tabs>` is wrapped in `@yourorg/ui`'s `DetailLayout`,
 * which adds a fixed 340px sticky rail OUTSIDE the tabs (`.ui-detail-rail`
 * in styles.css) — it stays visible across every tab instead of only
 * whichever one happens to be selected. The rail, top to bottom:
 *  - Relationship: "Client since" plus Sites/Assets/Orders/Quotes counters,
 *    each counter gated behind its own `*Enabled` flag (Sites has none —
 *    always shown) — leads the rail since it's the read-at-a-glance
 *    summary, ahead of Company's edit-oriented business details;
 *  - Company: `client.kvk_number`/`vat_number`/`iban` plus the primary
 *    site's own `phone` (moved off `clients` onto `sites`, migration
 *    `20260826130000_sites_phone.sql` — a client no longer has its own
 *    phone at all, no email either, `clients.email` was dropped in issue
 *    #43; a client's contact email now only lives on its `Contact` rows,
 *    see the Contacts tab) — no inline Edit of its own (removed — it opened
 *    the exact same `EditClientPanel` as the hero's own Edit button, one hop
 *    away at the top of the page);
 *  - Platform (platform-admin-only, `tenantAccessVisible`, accent-tinted):
 *    tenant active/deactivated status and a read-only modules line — pure
 *    read-out, management stays exclusively in the Modules tab;
 *  - Locations: the real Leaflet map (`SiteMapLoader`/`site-map.tsx`) with
 *    a pin per geocoded site, moved here from the Sites tab's old
 *    side-by-side `.ui-sites-grid` (see `sites-panel.tsx`, now a full-width
 *    table) so it's visible regardless of which tab is open, plus the same
 *    primary/other-sites legend that grid used to carry;
 *  - Notes: `client.notes`, only when present (previously a plain muted
 *    line directly under the hero — moved into the rail as its own card).
 */
export function ClientDetail({
  client,
  sites,
  canWrite,
  assets,
  assetsEnabled,
  canCreateAssets,
  canEditAssets,
  canDeleteAssets,
  contacts,
  contactRoles,
  workOrders,
  workOrdersEnabled,
  contracts,
  contractsEnabled,
  quotes,
  quotesEnabled,
  activities,
  activitiesEnabled,
  canCreateActivities,
  canEditActivities,
  canDeleteActivities,
  canCreateWorkOrder,
  isPlatformAdmin,
  accessStatusByEmail,
  defaultTab,
  accountManagers,
}: ClientDetailProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<ClientDetailTab>(defaultTab);
  const [focusSite, setFocusSite] = useState<{ siteId: string | null; token: number }>({
    siteId: null,
    token: 0,
  });
  const [, startTransition] = useTransition();

  const assetCountBySiteId = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets) {
      map.set(asset.site_id, (map.get(asset.site_id) ?? 0) + 1);
    }
    return map;
  }, [assets]);

  // Issue #41 redo ("Sites as client addresses"): `ClientRecord` no longer
  // carries its own address fields — the client's main address is whichever
  // of its `sites` has `is_primary = true` (the server guarantees at most
  // one, and every client with at least one site has exactly one, per
  // `createSite`'s "first site is forced primary" rule). Badged "Primary"
  // here to satisfy "1 adres is het hoofdadres ... ook zichtbaar maken met
  // badge ... op de detailpagina" — the same badge/label `sites-panel.tsx`
  // uses on the matching row in the Sites tab.
  const primarySite = useMemo(() => sites.find((site) => site.is_primary) ?? null, [sites]);

  // Rail "Locations" card map pins — moved here from `sites-panel.tsx`
  // (previously derived inside the Sites tab for its now-removed
  // `.ui-sites-grid` side-card) so the map lives outside the tabs and stays
  // visible regardless of which tab is selected. See that file's prior
  // version for the identical derivation this was copied from.
  const mapPins = useMemo<SiteMapPin[]>(
    () =>
      sites
        .filter((site) => site.latitude != null && site.longitude != null)
        .map((site) => ({
          siteId: site.id,
          addressLabel: formatSiteAddressShort(site) ?? "Unnamed site",
          latitude: site.latitude as number,
          longitude: site.longitude as number,
          addressLine1: site.address_line1,
          city: site.city,
          isPrimary: site.is_primary,
        })),
    [sites],
  );
  const primaryPin = mapPins.find((pin) => pin.isPrimary) ?? null;
  const otherPins = mapPins.filter((pin) => !pin.isPrimary);

  const breadcrumbItems = useMemo(
    () => [{ label: "Clients", href: "/clients" }, { label: client.name }],
    [client.name],
  );
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment. An inline `<Breadcrumbs items={breadcrumbItems} />` here would
  // be a fresh element every render and infinite-loop.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  function selectTab(next: ClientDetailTab) {
    setTab(next);
    startTransition(() => {
      void setLastUsedView(CLIENT_DETAIL_VIEW_KEY, next);
    });
  }

  function viewAssetsForSite(siteId: string) {
    setFocusSite((current) => ({ siteId, token: current.token + 1 }));
    selectTab("assets");
  }

  // Phone no longer appears here (design decision, rail redesign): it now
  // only lives in the rail's Company card (`primarySite.phone` below), so it
  // doesn't double up between the hero meta line and the rail. Only the
  // primary address stays in the hero.
  const heroMeta = [primarySite ? formatSiteAddress(primarySite) : null].filter(
    (item): item is string => Boolean(item),
  );

  // Issue #45: this client already represents a real platform tenant once
  // `represents_organization_id` is set — the "Activate as tenant" hero
  // action only makes sense before that.
  //
  // Issue #47 overturns the old "one-way, no un-activate" assumption that
  // used to live here: an activated tenant can now be deactivated and later
  // reactivated (`setTenantActive`, `../platform-access-actions.ts`), so
  // `isActivatedTenant` alone is no longer enough to decide what the hero
  // shows.
  const isActivatedTenant = Boolean(client.represents_organization_id);
  const isActiveTenant = client.organization_is_active === true;
  const isDeactivatedTenant = isActivatedTenant && client.organization_is_active === false;
  const showActivateTenant = isPlatformAdmin && !isActivatedTenant;
  // The "Access"/"Modules" tabs manage a tenant's real login/module access —
  // once a tenant is deactivated its users can no longer log in at all (the
  // login-gate half of issue #47), so letting a platform admin click into
  // "invite a user" or "toggle a module" for an org that currently can't log
  // in either way would just be confusing/dead UI on top of RLS already
  // blocking the underlying reads. Hiding the tabs outright (rather than a
  // disabled/explanatory state) also keeps this in sync with `page.tsx`,
  // which skips the `getTenantAccessStatus` fetch entirely once this is
  // false — there'd be nothing to show anyway. Reactivating (still visible
  // via the hero action below) is the way back in.
  const tenantAccessVisible = isPlatformAdmin && isActiveTenant;

  // Rail "Relationship" card counters — Sites has no `*Enabled` flag (a
  // client's sites always render), the rest mirror the same flags already
  // gating their own tab above.
  const relationshipStats = [
    { key: "sites", label: "Sites", value: sites.length, show: true },
    { key: "assets", label: "Assets", value: assets.length, show: assetsEnabled },
    { key: "workOrders", label: "Orders", value: workOrders.length, show: workOrdersEnabled },
    { key: "quotes", label: "Quotes", value: quotes.length, show: quotesEnabled },
    { key: "activities", label: "Meldingen", value: activities.length, show: activitiesEnabled },
  ].filter((stat) => stat.show);

  // Rail "Platform" card's read-only modules line. There's no persisted
  // per-tenant module entitlement yet (see `ModulesPanel`'s doc comment —
  // its toggles are a local-state-only stub), so this reuses the same
  // `*Enabled` flags already threaded down to gate this page's own tabs,
  // rather than inventing a new fetch — the best available read of "which
  // modules this client/tenant currently has visible".
  const activeModuleLabels = [
    assetsEnabled && "Assets",
    workOrdersEnabled && "Work Orders",
    contractsEnabled && "Contracts",
    quotesEnabled && "Quotes",
  ].filter((label): label is string => Boolean(label));

  const rail = (
    <>
      <Card>
        <Stack gap="sm">
          <Heading level={6}>Relationship</Heading>
          <DefinitionList items={[{ label: "Client since", value: formatClientSinceDate(client.created_at) }]} />
          <Separator />
          <div className="ui-detail-rail-stats">
            {relationshipStats.map((stat) => (
              <div className="ui-detail-rail-stat" key={stat.key}>
                <div className="ui-detail-rail-stat-value">{stat.value}</div>
                <Text tone="muted" className="ui-detail-rail-stat-label">
                  {stat.label}
                </Text>
              </div>
            ))}
          </div>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={6}>Company</Heading>
          <DefinitionList
            items={[
              { label: "KvK", value: client.kvk_number || <Text tone="muted">—</Text> },
              { label: "VAT", value: client.vat_number || <Text tone="muted">—</Text> },
              { label: "IBAN", value: client.iban || <Text tone="muted">—</Text> },
              { label: "Phone", value: primarySite?.phone || <Text tone="muted">—</Text> },
            ]}
          />
        </Stack>
      </Card>

      {/* Platform-admin-only, same `tenantAccessVisible` gate as the Access/
          Modules tabs above — a pure read-out (tenant status + which
          modules are currently visible), no management controls; managing
          either one stays exclusively in those tabs. */}
      {tenantAccessVisible && (
        <Card className="ui-card-accent">
          <Stack gap="sm">
            <Inline justify="between" align="center">
              <Heading level={6}>Platform</Heading>
              <Badge variant="accent">Admin only</Badge>
            </Inline>
            <DefinitionList
              items={[
                {
                  label: "Tenant",
                  value: isActiveTenant ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="danger">Deactivated</Badge>
                  ),
                },
                {
                  label: "Modules",
                  value:
                    activeModuleLabels.length > 0 ? activeModuleLabels.join(", ") : <Text tone="muted">—</Text>,
                },
              ]}
            />
          </Stack>
        </Card>
      )}

      {/* Site-address map — moved here from the Sites tab's old side-by-side
          `.ui-sites-grid` (see `sites-panel.tsx`) so it stays visible
          regardless of which tab is open. */}
      <Card className="ui-card-flush">
        <div className="ui-sites-map-head">Locations</div>
        <div className="ui-sites-map-frame">
          <SiteMapLoader pins={mapPins} />
        </div>
        {(primaryPin || otherPins.length > 0) && (
          <div className="ui-sites-map-legend">
            {primaryPin && (
              <div className="ui-sites-map-legend-item">
                <span className="ui-sites-map-legend-dot ui-sites-map-legend-dot-accent" aria-hidden="true" />
                <Text>{primaryPin.addressLabel}</Text>
              </div>
            )}
            {otherPins.length > 0 && (
              <div className="ui-sites-map-legend-item">
                <span className="ui-sites-map-legend-dot ui-sites-map-legend-dot-muted" aria-hidden="true" />
                <Text tone="muted">{otherPins.map((pin) => pin.city || pin.addressLabel).join(" · ")}</Text>
              </div>
            )}
          </div>
        )}
      </Card>

      {client.notes && (
        <Card>
          <Stack gap="sm">
            <Heading level={6}>Notes</Heading>
            <Text tone="muted">{client.notes}</Text>
          </Stack>
        </Card>
      )}
    </>
  );

  return (
    <Stack gap="lg">
      <DetailHero
        avatarLabel={client.name}
        title={client.name}
        meta={heroMeta}
        badges={
          <>
            {primarySite && <Badge variant="accent">Primary</Badge>}
            <Badge variant="muted">{formatClientSince(client.created_at)}</Badge>
            {/* Issue #47 acceptance criterion 1: visible to anyone who can see
                this page (not just the platform admin) whenever this client
                IS a tenant, active or not — a plain "is this a tenant" fact,
                distinct from the platform-admin-only manage actions below. */}
            {isActiveTenant && <Badge variant="success">Tenant</Badge>}
            {isDeactivatedTenant && <Badge variant="danger">Tenant deactivated</Badge>}
          </>
        }
        actions={
          canWrite || showActivateTenant || (isPlatformAdmin && isActivatedTenant) ? (
            <>
              {canWrite && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                    Delete
                  </Button>
                </>
              )}
              {showActivateTenant && <ActivateTenantAction clientId={client.id} />}
              {isPlatformAdmin && isActivatedTenant && (
                <TenantActiveToggleAction clientId={client.id} isActive={client.organization_is_active} />
              )}
            </>
          ) : undefined
        }
      />

      <DetailLayout rail={rail}>
        <Tabs value={tab} onValueChange={(next) => selectTab(next as ClientDetailTab)}>
          <Tabs.List aria-label="Client detail">
            <Tabs.Tab value="sites" icon={<MapPin />}>
              Sites{sites.length > 0 ? ` (${sites.length})` : ""}
            </Tabs.Tab>
            {assetsEnabled && (
              <Tabs.Tab value="assets" icon={<Boxes />}>
                Assets{assets.length > 0 ? ` (${assets.length})` : ""}
              </Tabs.Tab>
            )}
            <Tabs.Tab value="contacts" icon={<Users />}>
              Contacts{contacts.length > 0 ? ` (${contacts.length})` : ""}
            </Tabs.Tab>
            {workOrdersEnabled && (
              <Tabs.Tab value="workOrders" icon={<ClipboardList />}>
                Work Orders{workOrders.length > 0 ? ` (${workOrders.length})` : ""}
              </Tabs.Tab>
            )}
            {contractsEnabled && (
              <Tabs.Tab value="contracts" icon={<FileText />}>
                Contracts{contracts.length > 0 ? ` (${contracts.length})` : ""}
              </Tabs.Tab>
            )}
            {quotesEnabled && (
              <Tabs.Tab value="quotes" icon={<Receipt />}>
                Quotes{quotes.length > 0 ? ` (${quotes.length})` : ""}
              </Tabs.Tab>
            )}
            {activitiesEnabled && (
              <Tabs.Tab value="activities" icon={<Bell />}>
                Activiteiten{activities.length > 0 ? ` (${activities.length})` : ""}
              </Tabs.Tab>
            )}
            {tenantAccessVisible && (
              <Tabs.Tab value="access" icon={<ShieldCheck />}>
                Access
              </Tabs.Tab>
            )}
            {tenantAccessVisible && (
              <Tabs.Tab value="modules" icon={<Settings />}>
                Modules
              </Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="sites">
            <SitesPanel
              clientId={client.id}
              sites={sites}
              canWrite={canWrite}
              assetCountBySiteId={assetCountBySiteId}
              assetsEnabled={assetsEnabled}
              onViewAssets={assetsEnabled ? viewAssetsForSite : undefined}
              contacts={contacts}
              contactRoles={contactRoles}
            />
          </Tabs.Panel>

          {assetsEnabled && (
            <Tabs.Panel value="assets">
              <AssetsPanel
                clientId={client.id}
                sites={sites}
                assets={assets}
                canCreate={canCreateAssets}
                canEdit={canEditAssets}
                canDelete={canDeleteAssets}
                focusSiteId={focusSite.siteId}
                focusToken={focusSite.token}
              />
            </Tabs.Panel>
          )}

          <Tabs.Panel value="contacts">
            <ContactsPanel clientId={client.id} contacts={contacts} contactRoles={contactRoles} canWrite={canWrite} />
          </Tabs.Panel>

          {workOrdersEnabled && (
            <Tabs.Panel value="workOrders">
              <WorkOrdersPanel workOrders={workOrders} />
            </Tabs.Panel>
          )}

          {contractsEnabled && (
            <Tabs.Panel value="contracts">
              <ContractsPanel contracts={contracts} />
            </Tabs.Panel>
          )}

          {quotesEnabled && (
            <Tabs.Panel value="quotes">
              <QuotesPanel quotes={quotes} />
            </Tabs.Panel>
          )}

          {activitiesEnabled && (
            <Tabs.Panel value="activities">
              <ActivitiesPanel
                clientId={client.id}
                activities={activities}
                canCreate={canCreateActivities}
                canEdit={canEditActivities}
                canDelete={canDeleteActivities}
                canCreateWorkOrder={canCreateWorkOrder}
              />
            </Tabs.Panel>
          )}

          {tenantAccessVisible && (
            <Tabs.Panel value="access">
              <AccessPanel clientId={client.id} contacts={contacts} statusByEmail={accessStatusByEmail ?? {}} />
            </Tabs.Panel>
          )}

          {tenantAccessVisible && (
            <Tabs.Panel value="modules">
              <ModulesPanel />
            </Tabs.Panel>
          )}
        </Tabs>
      </DetailLayout>

      {canWrite && (
        <>
          <EditClientPanel
            client={client}
            accountManagers={accountManagers}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <DeleteClientDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            client={client}
            onDeleted={() => router.push("/clients")}
          />
        </>
      )}
    </Stack>
  );
}

/**
 * "Activate as tenant" hero action (issue #45) — platform-admin-only. Linking
 * a Client to a real `organizations` row (`represents_organization_id`) is
 * still one-way (there's no "un-link"), so a plain click isn't enough: the
 * first click swaps the button for an inline "Confirm"/"Cancel" pair rather
 * than opening a full `Dialog` (per the story: this doesn't warrant one).
 * On success, `router.refresh()` re-fetches the page's server data, which
 * both flips `client.represents_organization_id` (so this action itself
 * disappears) and reveals the new "Access"/"Modules" tabs.
 *
 * Once linked, whether that tenant can actually log in/use those tabs is a
 * separate, reversible flag — see `TenantActiveToggleAction` below
 * (issue #47).
 */
function ActivateTenantAction({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleActivate() {
    setError(null);
    setPending(true);
    activateAsTenant(clientId)
      .then((result) => {
        setPending(false);
        if (result.error || !result.data) {
          setError(result.error ?? "Could not activate this client as a tenant.");
          return;
        }
        setConfirming(false);
        router.refresh();
      })
      .catch(() => {
        setPending(false);
        setError("Could not activate this client as a tenant.");
      });
  }

  if (confirming) {
    return (
      <Inline gap="xs" align="center">
        <Text tone="danger">Turn this client into a real platform tenant?</Text>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
        <Button variant="success" size="sm" onClick={handleActivate} disabled={pending}>
          {pending ? "Activating…" : "Confirm"}
        </Button>
      </Inline>
    );
  }

  return (
    <Inline gap="xs" align="center">
      {error && <Text tone="danger">{error}</Text>}
      <Button variant="success" size="sm" onClick={() => setConfirming(true)}>
        Activate as tenant
      </Button>
    </Inline>
  );
}

/**
 * Deactivate/reactivate hero action (issue #47) — platform-admin-only,
 * rendered next to `ActivateTenantAction` once a client is already an
 * activated tenant. Calls `setTenantActive` (`../platform-access-actions.ts`)
 * with a fixed `active` value per direction, exactly as that action's own doc
 * comment anticipates.
 *
 * Deactivating immediately cuts off real users' login (issue #47 criterion
 * 4), so unlike the plain inline "Confirm"/"Cancel" pair `ActivateTenantAction`
 * uses, this warrants a real `Dialog` per this design system's confirmation
 * convention (mirrors `DeleteClientDialog`) — it's reversible, but the blast
 * radius (every user at that tenant losing access right now) is bigger than
 * a plain inline confirm reads as. Reactivating is fully additive (nobody
 * loses anything), so it needs no confirmation at all.
 */
function TenantActiveToggleAction({ clientId, isActive }: { clientId: string; isActive: boolean | null }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyToggle(next: boolean) {
    setError(null);
    setPending(true);
    setTenantActive(clientId, next)
      .then((result) => {
        setPending(false);
        if (result.error || !result.data) {
          setError(result.error ?? "Could not update this tenant's active status.");
          return;
        }
        setConfirmOpen(false);
        router.refresh();
      })
      .catch(() => {
        setPending(false);
        setError("Could not update this tenant's active status.");
      });
  }

  // `organization_is_active` is only ever `null` before a client is
  // activated as a tenant at all (see its doc comment in `../actions.ts`) —
  // this component only renders once `represents_organization_id` is set, so
  // in practice it's always a real boolean here. Treat anything other than
  // `true` as "not active" defensively rather than assuming that invariant.
  const active = isActive === true;

  return (
    <>
      <Inline gap="xs" align="center">
        {error && <Text tone="danger">{error}</Text>}
        {active ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            Deactivate tenant
          </Button>
        ) : (
          <Button variant="success" size="sm" onClick={() => applyToggle(true)} disabled={pending}>
            {pending ? "Reactivating…" : "Reactivate tenant"}
          </Button>
        )}
      </Inline>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} size="sm">
        <Dialog.Header>
          <Heading level={3}>Deactivate this tenant?</Heading>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap="sm">
            {error && <Text tone="danger">{error}</Text>}
            <Text tone="muted">
              Everyone at this organization will immediately lose the ability to log in. You can reactivate this
              tenant at any time to restore their access.
            </Text>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={() => applyToggle(false)} disabled={pending}>
            {pending ? "Deactivating…" : "Deactivate tenant"}
          </Button>
        </Dialog.Footer>
      </Dialog>
    </>
  );
}

/** Just the "{month} {year}" part, no "Client since" prefix — shared by
 * `formatClientSince` below (the hero's badge) and the rail's Relationship
 * card, which pairs it with its own "Client since" `DefinitionList` label
 * instead of repeating the phrase inside the value. */
function formatClientSinceDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Same "Client since {month} {year}" convention as `clients-table.tsx`'s
 * own `formatClientSince` (not imported from there — that one is a private
 * helper local to the table, not exported) — feeds the hero's "Client
 * since" badge, the only real (non-fabricated) client-tenure signal
 * available on `ClientRecord`. */
function formatClientSince(createdAt: string): string {
  return `Client since ${formatClientSinceDate(createdAt)}`;
}
