"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton, WebDetailLayout, WebPage, type WebBadgeVariant } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  scrollMainToTop,
  PageHeader,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import { getClientLogoUrl } from "@/lib/clients/logo-url";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ClientVolumeTotalsData } from "@/lib/asset-volumes/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatMonthYearWeb } from "@/lib/format/web";
import { setLastUsedView } from "@/lib/preferences/actions";
import type { ClientRecord, SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import type { TenantAccessStatus } from "../platform-access-actions";
import { ActivitiesPanel } from "./activities-panel";
import { DeleteClientDialog } from "../components/delete-client-dialog";
import { ClientOverviewCards } from "../components/client-overview-cards";
import { ClientLogoSlot } from "../components/client-logo-uploader";
import { draftFromClient, type ClientDraft } from "../components/client-draft";
import { articleOptionLabel, buildClientSchema, saveClientEdits } from "../components/client-form-schema";
import { CLIENT_STATUS_OPTIONS, type ClientStatus } from "../kanban";
import { formatSiteAddress, formatSiteAddressShort } from "../format-site-address";
import { AccessPanel } from "./access-panel";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { ContactsPanel } from "./contacts-panel";
import { ContractsPanel } from "./contracts-panel";
import { ModulesPanel } from "./modules-panel";
import { QuotesPanel } from "./quotes-panel";
import { ClientRail } from "./client-rail";
import { getLivePanel } from "./client-live-panel";
import { CLOSED_WORK_ORDER_STATUS_VALUES, buildClientTimeline } from "./client-timeline";
import { ActivateTenantDialog, DeactivateTenantDialog, reactivateTenant } from "./client-tenant-actions";
import type { SiteMapPin } from "./site-map-loader";
import { SitesPanel } from "./sites-panel";
import { VolumesPanel } from "./volumes-panel";
import { WorkOrdersPanel } from "./work-orders-panel";

export type ClientDetailTab =
  | "overview"
  | "sites"
  | "assets"
  | "volumes"
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
  /** `can(actor, "clients", "delete")` — gates the Delete entry of the ···
   * menu, independent of `canWrite`. */
  canDelete: boolean;
  assets: AssetRecord[];
  assetsEnabled: boolean;
  canCreateAssets: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  /** Client volume totals (issue #221); null = the Volumes tab is not
   * entitled/readable for this actor, so it does not render. */
  volumeTotals: ClientVolumeTotalsData | null;
  contacts: ContactRecord[];
  contactRoles: ReferenceListItemRecord[];
  workOrders: WorkOrderRecord[];
  workOrdersEnabled: boolean;
  contracts: ContractRecord[];
  contractsEnabled: boolean;
  canCreateContracts: boolean;
  quotes: QuoteRecord[];
  quotesEnabled: boolean;
  activities: ActivityRecord[];
  activitiesEnabled: boolean;
  canCreateActivities: boolean;
  canCreateWorkOrder: boolean;
  /** `session.isPlatformAdmin` (issue #45): gates "Activate as tenant" and the
   * tenant (de)activation entries. */
  isPlatformAdmin: boolean;
  /** Platform admin AND the client is an ACTIVE tenant — gates the Access and
   * Modules tabs and the rail's Platform section (issues #45/#47/#113). */
  tenantAccessVisible: boolean;
  accessStatusByEmail: Record<string, TenantAccessStatus> | null;
  defaultTab: ClientDetailTab;
  accountManagers: AccountManagerRecord[];
  articles: ArticleSelectOption[];
}

const STATUS_BADGE_VARIANT: Record<ClientStatus, WebBadgeVariant> = {
  lead: "info",
  qualified: "info",
  proposal: "warning",
  won: "success",
};

/**
 * Client detail page (design system pilot, issue #222). One page skeleton:
 * `PageHeader` (breadcrumb, logo, name, badges, ONE Edit button, ··· menu, the
 * single navy primary action, owner line, tabs with counts) over
 * `WebDetailLayout` (centre = the active tab, rail = key figures + sites +
 * timeline).
 *
 * Editing: the Overview tab's cards are edited through ONE mechanism —
 * `useEditMode` — from the single Edit button; saving goes through the same
 * server actions as before (`saveClientEdits` → `updateClient` /
 * `updateClientRateSettings`), so RBAC and RLS are untouched. The Edit button
 * is omitted entirely without `clients:update`, and only shows on Overview
 * (list tabs keep their own "+ New …" buttons). While editing, tabs and rail
 * are locked.
 *
 * Related lists (Sites, Assets, Volumes, Contacts, Work orders, Contracts,
 * Quotes, Activities, plus Access/Modules for platform admins) are the same
 * panels as before. Per docs/ARCHITECTURE.md ("Relational detail pages") the
 * Sites ↔ Assets cross-tab jump (`viewAssetsForSite`) is kept.
 */
export function ClientDetail({
  client,
  sites,
  canWrite,
  canDelete,
  assets,
  assetsEnabled,
  canCreateAssets,
  canEditAssets,
  canDeleteAssets,
  volumeTotals,
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
  tenantAccessVisible,
  accessStatusByEmail,
  defaultTab,
  accountManagers,
  articles,
}: ClientDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ClientDetailTab>(defaultTab);
  const [focusSite, setFocusSite] = useState<{ siteId: string | null; token: number }>({ siteId: null, token: 0 });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Local echo of the logo so an upload shows instantly (issue #120).
  const [logoUrl, setLogoUrl] = useState<string | null>(() =>
    getClientLogoUrl(client.logo_path, client.logo_updated_at),
  );
  useEffect(() => setLogoUrl(getClientLogoUrl(client.logo_path, client.logo_updated_at)), [
    client.logo_path,
    client.logo_updated_at,
  ]);

  // --- Edit mode ------------------------------------------------------------
  const record = useMemo(() => draftFromClient(client), [client]);
  const schema = useMemo(
    () =>
      buildClientSchema({
        accountManagerLabel: (id) => {
          const manager = accountManagers.find((item) => item.id === id);
          return manager ? `${manager.first_name} ${manager.last_name}`.trim() : "";
        },
        articleLabel: (id) => {
          const article = articles.find((item) => item.id === id);
          return article ? articleOptionLabel(article) : "";
        },
      }),
    [accountManagers, articles],
  );
  const edit = useEditMode<ClientDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "client",
    firstFieldKey: "name",
    navigate: (href) => router.push(href),
    onSave: (draft, dirty) => saveClientEdits(client.id, draft, dirty),
    onSaved: () => {
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // --- Derived data ---------------------------------------------------------
  const assetCountBySiteId = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets) map.set(asset.site_id, (map.get(asset.site_id) ?? 0) + 1);
    return map;
  }, [assets]);

  const primarySite = useMemo(() => sites.find((site) => site.is_primary) ?? null, [sites]);
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

  const accountManagerName = useMemo(() => {
    if (!client.account_manager_id) return null;
    const manager = accountManagers.find((item) => item.id === client.account_manager_id);
    return manager ? `${manager.first_name} ${manager.last_name}`.trim() || null : null;
  }, [client.account_manager_id, accountManagers]);

  // "Active" = no end date, or an end date that hasn't passed yet.
  const activeContracts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return contracts.filter((contract) => !contract.end_date || contract.end_date >= today);
  }, [contracts]);
  const activeContractsValue = useMemo(
    () => activeContracts.reduce((sum, contract) => sum + (contract.value ?? 0), 0),
    [activeContracts],
  );
  const openWorkOrders = useMemo(
    () => workOrders.filter((order) => !CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "")),
    [workOrders],
  );
  const nextAppointment = useMemo(() => {
    const now = Date.now();
    const upcoming = openWorkOrders
      .filter((order): order is WorkOrderRecord & { scheduled_at: string } => Boolean(order.scheduled_at))
      .filter((order) => new Date(order.scheduled_at).getTime() >= now)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    return upcoming[0]?.scheduled_at ?? null;
  }, [openWorkOrders]);

  const timeline = useMemo(
    () =>
      buildClientTimeline({
        client,
        activities: activitiesEnabled ? activities : null,
        workOrders: workOrdersEnabled ? workOrders : null,
        contracts: contractsEnabled ? contracts : null,
        quotes: quotesEnabled ? quotes : null,
      }),
    [
      client,
      activities,
      activitiesEnabled,
      workOrders,
      workOrdersEnabled,
      contracts,
      contractsEnabled,
      quotes,
      quotesEnabled,
    ],
  );

  const isActivatedTenant = Boolean(client.represents_organization_id);
  const isActiveTenant = client.organization_is_active === true;
  const isDeactivatedTenant = isActivatedTenant && client.organization_is_active === false;
  const showActivateTenant = isPlatformAdmin && !isActivatedTenant;

  // Modules line of the rail's Platform section — same `*Enabled` flags that
  // gate the tabs (there is no persisted per-tenant module entitlement yet).
  const activeModuleLabels = [
    assetsEnabled && "Assets",
    workOrdersEnabled && "Work Orders",
    contractsEnabled && "Contracts",
    quotesEnabled && "Quotes",
  ].filter((label): label is string => Boolean(label));

  // --- Tabs -----------------------------------------------------------------
  function selectTab(next: ClientDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(CLIENT_DETAIL_VIEW_KEY, next);
    });
  }

  function viewAssetsForSite(siteId: string) {
    setFocusSite((current) => ({ siteId, token: current.token + 1 }));
    selectTab("assets");
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      { id: "sites", label: "Sites", count: sites.length },
      ...(assetsEnabled ? [{ id: "assets", label: "Assets", count: assets.length }] : []),
      ...(volumeTotals ? [{ id: "volumes", label: "Volumes" }] : []),
      { id: "contacts", label: "Contacts", count: contacts.length },
      ...(workOrdersEnabled
        ? [
            openWorkOrders.length > 0
              ? { id: "workOrders", label: "Work orders", count: openWorkOrders.length, attention: "open" }
              : { id: "workOrders", label: "Work orders", count: workOrders.length },
          ]
        : []),
      ...(contractsEnabled ? [{ id: "contracts", label: "Contracts", count: contracts.length }] : []),
      ...(quotesEnabled ? [{ id: "quotes", label: "Quotes", count: quotes.length }] : []),
      ...(activitiesEnabled ? [{ id: "activities", label: "Activities", count: activities.length }] : []),
      ...(tenantAccessVisible
        ? [
            { id: "access", label: "Access" },
            { id: "modules", label: "Modules" },
          ]
        : []),
    ],
    [
      sites.length,
      assetsEnabled,
      assets.length,
      volumeTotals,
      contacts.length,
      workOrdersEnabled,
      workOrders.length,
      openWorkOrders.length,
      contractsEnabled,
      contracts.length,
      quotesEnabled,
      quotes.length,
      activitiesEnabled,
      activities.length,
      tenantAccessVisible,
    ],
  );

  // A tab can disappear while open (e.g. the tenant was just deactivated, so
  // Access/Modules are gone) — fall back to Overview instead of a blank panel.
  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // --- Header ---------------------------------------------------------------
  // Order per the design system: main status → warnings → classification →
  // facts → ID. `PageHeader` caps the row at 5, so the least important fact
  // (city) is listed last and drops off first.
  const badges: PageHeaderBadge[] = [];
  const statusLabel = CLIENT_STATUS_OPTIONS.find((option) => option.value === client.status)?.label ?? client.status;
  badges.push({ label: statusLabel, variant: STATUS_BADGE_VARIANT[client.status as ClientStatus] ?? "neutral" });
  if (isActiveTenant) badges.push({ label: "Tenant", variant: "success" });
  if (isDeactivatedTenant) badges.push({ label: "Tenant deactivated", variant: "danger" });
  if (contractsEnabled && activeContracts.length === 0) badges.push({ label: "No contract", variant: "warning" });
  if (workOrdersEnabled && openWorkOrders.length > 0) {
    badges.push({
      label: `${openWorkOrders.length} open ${openWorkOrders.length === 1 ? "work order" : "work orders"}`,
      variant: "warning",
    });
  }
  badges.push({ label: `Client since ${formatMonthYearWeb(client.client_since ?? client.created_at)}` });
  if (primarySite?.city) badges.push({ label: primarySite.city });

  const overflow: WebMenuItem[] = [];
  if (isPlatformAdmin && isActivatedTenant) {
    overflow.push(
      isActiveTenant
        ? { key: "deactivate", label: "Deactivate tenant", onSelect: () => setDeactivateOpen(true) }
        : {
            key: "reactivate",
            label: "Reactivate tenant",
            onSelect: () => void reactivateTenant(client.id, () => router.refresh()),
          },
    );
  }
  if (canDelete) {
    if (overflow.length > 0) overflow.push({ type: "separator", key: "sep" });
    overflow.push({ key: "delete", label: "Delete client", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  const header = (
    <PageHeader
      breadcrumb={[{ label: "Clients", href: "/clients" }, { label: client.name }]}
      title={client.name}
      logo={
        <ClientLogoSlot
          clientId={client.id}
          clientName={client.name}
          logoUrl={logoUrl}
          onLogoChange={setLogoUrl}
          editable={editing && canWrite}
        />
      }
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: canWrite && tab === "overview",
        onEdit: edit.startEdit,
        overflow,
        primary: showActivateTenant ? (
          <WebButton variant="primary" onClick={() => setActivateOpen(true)}>
            Activate as tenant
          </WebButton>
        ) : undefined,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: "Save",
      }}
      owner={accountManagerName ? { name: accountManagerName, role: "Account manager" } : null}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as ClientDetailTab)}
      tabsLabel="Client sections"
      editStatus={edit.status}
    />
  );

  // Today in Amsterdam (the app's display zone), for date-only deadlines.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
  const livePanel = useMemo(
    () => getLivePanel({ quotes: quotesEnabled ? quotes : null, today }, null),
    [quotes, quotesEnabled, today],
  );

  const rail = (
    <ClientRail
      livePanel={livePanel}
      accountManagerName={accountManagerName}
      activeContracts={contractsEnabled ? { count: activeContracts.length, value: activeContractsValue } : null}
      openWorkOrders={workOrdersEnabled ? { count: openWorkOrders.length, nextAppointment } : null}
      potentialValue={client.potential_value}
      primaryAddress={primarySite ? formatSiteAddress(primarySite) : null}
      otherSiteCount={Math.max(0, sites.length - (primarySite ? 1 : 0))}
      mapPins={mapPins}
      onManageSites={() => selectTab("sites")}
      platform={
        tenantAccessVisible
          ? { isActive: isActiveTenant, modules: activeModuleLabels, onManage: () => selectTab("access") }
          : null
      }
    />
  );

  const ids = webTabIds(tab);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{ items: timeline, emptyText: "No activity yet" }}
        locked={editing}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <ClientOverviewCards
            edit={edit}
            accountManagers={accountManagers}
            articles={articles}
            derived={{
              address: primarySite ? formatSiteAddress(primarySite) : null,
              phone: primarySite?.phone ?? null,
            }}
            isNew={false}
          />
        )}

        {tab === "sites" && (
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
        )}

        {tab === "assets" && assetsEnabled && (
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
        )}

        {tab === "volumes" && volumeTotals && <VolumesPanel data={volumeTotals} />}

        {tab === "contacts" && (
          <ContactsPanel clientId={client.id} contacts={contacts} contactRoles={contactRoles} canWrite={canWrite} />
        )}

        {tab === "workOrders" && workOrdersEnabled && (
          <WorkOrdersPanel clientId={client.id} workOrders={workOrders} canCreate={canCreateWorkOrder} />
        )}

        {tab === "contracts" && contractsEnabled && (
          <ContractsPanel clientId={client.id} contracts={contracts} canCreate={canCreateContracts} />
        )}

        {tab === "quotes" && quotesEnabled && <QuotesPanel quotes={quotes} />}

        {tab === "activities" && activitiesEnabled && (
          <ActivitiesPanel clientId={client.id} activities={activities} canCreate={canCreateActivities} />
        )}

        {tab === "access" && tenantAccessVisible && (
          <AccessPanel clientId={client.id} contacts={contacts} statusByEmail={accessStatusByEmail ?? {}} />
        )}

        {tab === "modules" && tenantAccessVisible && <ModulesPanel />}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />

      {canDelete && (
        <DeleteClientDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          client={client}
          onDeleted={() => router.push("/clients")}
        />
      )}
      {showActivateTenant && (
        <ActivateTenantDialog open={activateOpen} clientId={client.id} onClose={() => setActivateOpen(false)} />
      )}
      {isPlatformAdmin && isActivatedTenant && (
        <DeactivateTenantDialog
          open={deactivateOpen}
          clientId={client.id}
          onClose={() => setDeactivateOpen(false)}
        />
      )}
    </WebPage>
  );
}
