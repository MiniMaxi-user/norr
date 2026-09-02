"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DefinitionList,
  DetailLayout,
  Dialog,
  Heading,
  IconButton,
  Inline,
  RecordHeroBand,
  Stack,
  StatStrip,
  Tabs,
  Text,
  type StatStripItem,
} from "@yourorg/ui";
import { Bell, Boxes, ClipboardList, FileText, MapPin, Pencil, Receipt, Settings, ShieldCheck, Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
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
import { formatCurrency } from "@/lib/format/currency";
import { formatDateTime, formatTimestamp } from "@/lib/format/date";
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
  | "activities";

/** The Platform rail card's own popup tabs (issue #113) — "Access"/"Modules"
 * moved off the page's main `Tabs` (see `ClientDetailTab` above, which no
 * longer includes them) into a small platform-admin-only `Dialog` reached via
 * an Edit `IconButton` on that card. Not part of `setLastUsedView`/the
 * `?tab=` deep-link contract at all — this is a secondary management popup,
 * not one of the page's own navigable views. */
type PlatformDialogTab = "access" | "modules";

/** `work_order_status.value`s that mean "done" (seeded in
 * `20260823120000_work_orders_core.sql`'s lifecycle list) — everything short
 * of these still needs attention. Feeds the hero's "Open work orders" tile
 * below. */
const CLOSED_WORK_ORDER_STATUS_VALUES = ["completed", "invoiced"];

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
  /** `can(actor, "contracts", "create")`, resolved once by `page.tsx` — same
   * gate the standalone Contracts module page's own "New contract" button
   * uses, threaded down for the Contracts tab's own "+ Contract" button
   * (issue #113 follow-up). */
  canCreateContracts: boolean;
  quotes: QuoteRecord[];
  quotesEnabled: boolean;
  activities: ActivityRecord[];
  activitiesEnabled: boolean;
  canCreateActivities: boolean;
  /** Gates `WorkOrdersPanel`'s own "+ Work order" tab action —
   * `hasFeature(org, "planning")` + `canAccessModule`/`can(actor, "planning",
   * "create")`, resolved once by `page.tsx`, independent of
   * `workOrdersEnabled`/`activitiesEnabled`. */
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
  /** `listArticlesForSelect()`'s result (issue #93), fetched once in
   * `page.tsx` — populates `EditClientPanel`'s "Rate" section article
   * pickers, same "fetch once, pass down" convention as `accountManagers`. */
  articles: ArticleSelectOption[];
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
 * `components/shell/page-header-context.tsx`). The client's own fields sit in
 * the full-bleed dark `RecordHeroBand` (`@yourorg/ui`) — the same header
 * pattern Work Orders/Assets/Contracts already use: a plain `<h1>` title, a
 * `meta` row underneath it whose FIRST item is "Primary"/"Client since"/
 * tenant badges (`ui-record-hero-band-meta-badges`, same wrapper/placement
 * Work Orders uses for its status/priority pair, issue #106) followed by the
 * icon+text primary-address fact, and a `StatStrip` (`heroStats` below)
 * baked into the bottom of the band. Issue #113 follow-up: badges used to
 * render via `RecordHeroBand`'s separate `badges` prop, its own row ABOVE
 * the title — moved into `meta` instead so they sit on the same line as the
 * address, below the title, per explicit product feedback.
 *
 * Issue #113: `heroStats` deliberately does NOT repeat the Sites/Assets/Work
 * Orders/Quotes/Activities counts that used to live here — every one of
 * those is already visible as a `(count)` suffix on its own `Tabs.Tab` right
 * below, so restating them in the hero was pure duplication. Instead the
 * strip surfaces facts that aren't visible anywhere else on this page: the
 * client's Account Manager (resolved from `accountManagers` by
 * `client.account_manager_id`, same lookup `EditClientPanel`'s picker uses),
 * an active-contracts count + total value, an open-work-orders count (i.e.
 * not yet `completed`/`invoiced`, mirroring the "needs attention" framing
 * `work-order-screen.tsx`'s own hero stats use) with its next-scheduled date
 * as the hint, and the most recent Activiteit's `reported_at` with its type
 * as the hint. Each of the three relationship-derived tiles is gated behind
 * the same `*Enabled` flag its tab already uses; Account Manager always
 * shows (it's a plain client field, not a relationship count). Nothing here
 * required a new fetch — every value is derived from props this component
 * already receives (`accountManagers`/`contracts`/`workOrders`/`activities`).
 * This is a deliberate hybrid, not a full conversion to the `RecordHeroBand`
 * pattern's usual accompanying flat-card layout: the tab-driven rail below
 * stays exactly as it is (see docs/ARCHITECTURE.md's "Two detail-page header
 * patterns" section).
 *
 * Below the hero, `<Tabs>` is wrapped in `@yourorg/ui`'s `DetailLayout`,
 * which adds a fixed 340px sticky rail OUTSIDE the tabs (`.ui-detail-rail`
 * in styles.css) — it stays visible across every tab instead of only
 * whichever one happens to be selected. The rail, top to bottom (no more
 * "Relationship" card — its counters now live in the hero's `StatStrip`
 * instead):
 *  - Company: `client.kvk_number`/`vat_number`/`iban` plus the primary
 *    site's own `phone` (moved off `clients` onto `sites`, migration
 *    `20260826130000_sites_phone.sql` — a client no longer has its own
 *    phone at all, no email either, `clients.email` was dropped in issue
 *    #43; a client's contact email now only lives on its `Contact` rows,
 *    see the Contacts tab) — no inline Edit of its own (removed — it opened
 *    the exact same `EditClientPanel` as the hero's own Edit button, one hop
 *    away at the top of the page);
 *  - Platform (platform-admin-only, `tenantAccessVisible`, accent-tinted):
 *    tenant active/deactivated status and a read-only modules line, plus
 *    (issue #113) a `Pencil` `IconButton` in its header row that opens a
 *    small `Dialog` (`platformDialogOpen` below) with the same
 *    `AccessPanel`/`ModulesPanel` content as two nested `Tabs` — those two
 *    used to be their own page-level `Tabs.Tab`s; per the story they're a
 *    platform-admin-only management surface that doesn't need to compete for
 *    space with the client's own relational tabs, so they moved into this
 *    card's edit popup instead (docs/ARCHITECTURE.md "Popup vs. full page":
 *    a small sub-entity management surface, not a top-level module);
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
  canCreateContracts,
  quotes,
  quotesEnabled,
  activities,
  activitiesEnabled,
  canCreateActivities,
  canCreateWorkOrder,
  isPlatformAdmin,
  accessStatusByEmail,
  defaultTab,
  accountManagers,
  articles,
}: ClientDetailProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<ClientDetailTab>(defaultTab);
  // Issue #113: the Platform rail card's own Edit popup — replaces the old
  // "Access"/"Modules" page-level tabs (see `ClientDetailTab` above).
  // `platformTab` is local to the popup, not persisted via `setLastUsedView`
  // (unlike `tab`) — it's a secondary management surface, not one of the
  // page's own navigable views.
  const [platformDialogOpen, setPlatformDialogOpen] = useState(false);
  const [platformTab, setPlatformTab] = useState<PlatformDialogTab>("access");
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

  // Issue #113 follow-up: badges live in the `meta` row (below the title,
  // beside the address), not `RecordHeroBand`'s separate `badges` prop
  // (rendered as its own row ABOVE the title) — product feedback was
  // explicit these read as one line together, not two. Same
  // `ui-record-hero-band-meta-badges` wrapper + "first meta item" placement
  // Work Orders already uses for its status/priority pair (issue #106,
  // `work-order-hero.tsx`), reused here for Primary/"Client since"/Tenant
  // instead. Phone no longer appears in `meta` (design decision, rail
  // redesign): it now only lives in the rail's Company card
  // (`primarySite.phone` below), so it doesn't double up between the hero
  // meta line and the rail.
  const heroMeta: ReactNode[] = [
    <span className="ui-record-hero-band-meta-badges" key="badges">
      {primarySite && <Badge variant="accent">Primary</Badge>}
      <Badge variant="muted">{formatClientSince(client.created_at)}</Badge>
      {/* Issue #47 acceptance criterion 1: visible to anyone who can see
          this page (not just the platform admin) whenever this client IS a
          tenant, active or not — a plain "is this a tenant" fact, distinct
          from the platform-admin-only manage actions in the rail. */}
      {isActiveTenant && <Badge variant="success">Tenant</Badge>}
      {isDeactivatedTenant && <Badge variant="danger">Tenant deactivated</Badge>}
    </span>,
  ];
  if (primarySite) {
    heroMeta.push(
      <>
        <MapPin /> {formatSiteAddress(primarySite)}
      </>,
    );
  }
  // The rail's Platform card (and its Access/Modules edit popup, issue #113)
  // manage a tenant's real login/module access — once a tenant is
  // deactivated its users can no longer log in at all (the login-gate half
  // of issue #47), so letting a platform admin click into "invite a user" or
  // "toggle a module" for an org that currently can't log in either way
  // would just be confusing/dead UI on top of RLS already blocking the
  // underlying reads. Hiding the card outright (rather than a disabled/
  // explanatory state) also keeps this in sync with `page.tsx`, which skips
  // the `getTenantAccessStatus` fetch entirely once this is false — there'd
  // be nothing to show anyway. Reactivating (still visible via the hero
  // action below) is the way back in.
  const tenantAccessVisible = isPlatformAdmin && isActiveTenant;

  // Hero `StatStrip` tiles (issue #113) — see this component's own doc
  // comment above for why these specific four (not the old Sites/Assets/
  // Orders/Quotes/Meldingen counts, which just duplicated each tab's own
  // `(count)` suffix).
  const accountManagerName = useMemo(() => {
    if (!client.account_manager_id) return null;
    const manager = accountManagers.find((item) => item.id === client.account_manager_id);
    return manager ? `${manager.first_name} ${manager.last_name}`.trim() || null : null;
  }, [client.account_manager_id, accountManagers]);

  // "Active" = no end date, or an end date that hasn't passed yet — the best
  // available read of "still in force" from `ContractRecord`'s own fields
  // (there's no separate `status` column on contracts, see `actions.ts`).
  const activeContracts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return contracts.filter((contract) => !contract.end_date || contract.end_date >= today);
  }, [contracts]);
  const activeContractsValue = useMemo(
    () => activeContracts.reduce((sum, contract) => sum + (contract.value ?? 0), 0),
    [activeContracts],
  );

  // "Open" = not yet at a terminal `work_order_status` — same framing
  // `work-order-screen.tsx`'s own hero stats use for "To invoice".
  const openWorkOrders = useMemo(
    () => workOrders.filter((order) => !CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "")),
    [workOrders],
  );
  const nextScheduledWorkOrder = useMemo(() => {
    const scheduled = openWorkOrders
      .filter((order): order is WorkOrderRecord & { scheduled_at: string } => Boolean(order.scheduled_at))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    return scheduled[0] ?? null;
  }, [openWorkOrders]);

  const lastActivity = useMemo(() => {
    if (activities.length === 0) return null;
    return [...activities].sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())[0];
  }, [activities]);

  const heroStats: StatStripItem[] = [
    {
      label: "Account manager",
      value: accountManagerName ?? "Unassigned",
      hint: accountManagerName ? undefined : "No manager assigned",
    },
  ];
  if (contractsEnabled) {
    heroStats.push({
      label: "Active contracts",
      value: activeContracts.length,
      hint: activeContractsValue > 0 ? `${formatCurrency(activeContractsValue)} total value` : undefined,
    });
  }
  if (workOrdersEnabled) {
    heroStats.push({
      label: "Open work orders",
      value: openWorkOrders.length,
      hint:
        openWorkOrders.length === 0
          ? "All caught up"
          : nextScheduledWorkOrder
            ? `Next: ${formatDateTime(nextScheduledWorkOrder.scheduled_at, { year: false })}`
            : "Not yet scheduled",
    });
  }
  if (activitiesEnabled) {
    heroStats.push({
      label: "Last activity",
      value: lastActivity ? formatTimestamp(lastActivity.reported_at) : "—",
      hint: lastActivity?.activity_type?.label,
    });
  }

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

      {/* Platform-admin-only, same `tenantAccessVisible` gate the Access/
          Modules popup below reuses — a read-out (tenant status + which
          modules are currently visible) plus (issue #113) an Edit
          `IconButton` opening that popup; managing either one stays
          exclusively inside it, never inline on this card. */}
      {tenantAccessVisible && (
        <Card tone="accent">
          <Stack gap="sm">
            <Inline justify="between" align="center">
              <Heading level={6}>Platform</Heading>
              <Inline gap="xs" align="center">
                <Badge variant="accent">Admin only</Badge>
                <IconButton
                  variant="ghost"
                  aria-label="Edit tenant access and modules"
                  onClick={() => setPlatformDialogOpen(true)}
                >
                  <Pencil />
                </IconButton>
              </Inline>
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
      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{client.name}</h1>}
        meta={heroMeta}
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
        stats={<StatStrip items={heroStats} />}
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
              <WorkOrdersPanel clientId={client.id} workOrders={workOrders} canCreate={canCreateWorkOrder} />
            </Tabs.Panel>
          )}

          {contractsEnabled && (
            <Tabs.Panel value="contracts">
              <ContractsPanel clientId={client.id} contracts={contracts} canCreate={canCreateContracts} />
            </Tabs.Panel>
          )}

          {quotesEnabled && (
            <Tabs.Panel value="quotes">
              <QuotesPanel quotes={quotes} />
            </Tabs.Panel>
          )}

          {activitiesEnabled && (
            <Tabs.Panel value="activities">
              <ActivitiesPanel clientId={client.id} activities={activities} canCreate={canCreateActivities} />
            </Tabs.Panel>
          )}

        </Tabs>
      </DetailLayout>

      {canWrite && (
        <>
          <EditClientPanel
            client={client}
            accountManagers={accountManagers}
            articles={articles}
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

      {/* Platform rail card's Edit popup (issue #113) — "Access"/"Modules"
          used to be their own page-level `Tabs.Tab`s; they're the same
          `AccessPanel`/`ModulesPanel` content, unchanged internally, just
          reached from the Platform card's `Pencil` `IconButton` now, as two
          nested `Tabs` inside a `Dialog size="panel"` (matching
          `EditClientPanel`'s slide-in convention — this is a small,
          platform-admin-only management surface, not a top-level module, per
          docs/ARCHITECTURE.md's "Popup vs. full page"). Only ever rendered
          when `tenantAccessVisible` (same gate the card itself uses). */}
      {tenantAccessVisible && (
        <Dialog open={platformDialogOpen} onOpenChange={setPlatformDialogOpen} size="panel">
          <Dialog.Header>
            <Heading level={3}>Tenant access &amp; modules</Heading>
          </Dialog.Header>
          <Dialog.Body>
            <Tabs value={platformTab} onValueChange={(next) => setPlatformTab(next as PlatformDialogTab)}>
              <Tabs.List aria-label="Tenant access and modules">
                <Tabs.Tab value="access" icon={<ShieldCheck />}>
                  Access
                </Tabs.Tab>
                <Tabs.Tab value="modules" icon={<Settings />}>
                  Modules
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="access">
                <AccessPanel clientId={client.id} contacts={contacts} statusByEmail={accessStatusByEmail ?? {}} />
              </Tabs.Panel>
              <Tabs.Panel value="modules">
                <ModulesPanel />
              </Tabs.Panel>
            </Tabs>
          </Dialog.Body>
        </Dialog>
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
 * disappears) and reveals the rail's Platform card (issue #113: with its
 * Access/Modules edit popup).
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
