"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Breadcrumbs, Button, DetailHero, Dialog, Heading, Inline, Stack, Tabs, Text } from "@yourorg/ui";
import { Boxes, ClipboardList, FileText, MapPin, Receipt, Settings, ShieldCheck, Users } from "@yourorg/ui/icons";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { activateAsTenant, type ClientRecord, type SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import { setTenantActive, type TenantAccessStatus } from "../platform-access-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteClientDialog } from "../delete-client-dialog";
import { EditClientPanel } from "../edit-client-panel";
import { formatSiteAddress } from "../format-site-address";
import { setLastUsedView } from "@/lib/preferences/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { AccessPanel } from "./access-panel";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { ContactsPanel } from "./contacts-panel";
import { ContractsPanel } from "./contracts-panel";
import { ModulesPanel } from "./modules-panel";
import { QuotesPanel } from "./quotes-panel";
import { SitesPanel } from "./sites-panel";
import { WorkOrdersPanel } from "./work-orders-panel";

export type ClientDetailTab =
  | "sites"
  | "assets"
  | "contacts"
  | "workOrders"
  | "contracts"
  | "quotes"
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
 * dot-separated phone/primary-address meta line — the phone shown is the
 * primary site's own `phone` (moved off `clients` onto `sites`, migration
 * `20260826130000_sites_phone.sql`), not a client-level field, since a
 * client no longer has its own phone at all (no email either — `clients.email`
 * was dropped in issue #43; a client's contact email now only lives on its
 * `Contact` rows, see the Contacts tab), and "Primary"/
 * "Client since" badges — the now-canonical header pattern for a top-level
 * entity's detail page (see `stories/EditorialDetailPage.stories.tsx` and
 * docs/ARCHITECTURE.md's "Relational detail pages" section). `client.notes`
 * has no slot in that hero (the approved mockup's meta-line doesn't carry
 * it), so it renders as a small muted line just below, only when present.
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
  isPlatformAdmin,
  accessStatusByEmail,
  defaultTab,
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

  const heroMeta = [primarySite?.phone, primarySite ? formatSiteAddress(primarySite) : null].filter(
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

      {client.notes && <Text tone="muted">{client.notes}</Text>}

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

      {canWrite && (
        <>
          <EditClientPanel client={client} open={editOpen} onOpenChange={setEditOpen} />
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

/** Same "Client since {month} {year}" convention as `clients-table.tsx`'s
 * own `formatClientSince` (not imported from there — that one is a private
 * helper local to the table, not exported) — feeds the hero's "Client
 * since" badge, the only real (non-fabricated) client-tenure signal
 * available on `ClientRecord`. */
function formatClientSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Client since —";
  return `Client since ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
