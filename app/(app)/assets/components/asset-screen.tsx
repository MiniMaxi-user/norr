"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import {
  SidebarSection,
  WebDetailLayout,
  WebLinkButton,
  WebPage,
  type WebBadgeVariant,
} from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  scrollMainToTop,
  toneFromColor,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import { getClient, listClients, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { listAssetModels, type AssetModelRecord } from "@/lib/asset-models/actions";
import type { AssetVolumesData } from "@/lib/asset-volumes/actions";
import { unlinkContractAsset, type AssetContractCoverage } from "@/app/(app)/contracts/actions";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { ActivitiesPanel } from "@/app/(app)/clients/[id]/activities-panel";
import { WorkOrdersPanel } from "@/app/(app)/clients/[id]/work-orders-panel";
import { CLOSED_WORK_ORDER_STATUS_VALUES } from "@/app/(app)/clients/[id]/client-timeline";
import { useClientScopedLists } from "@/app/(app)/work-orders/components/use-client-scoped-lists";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { contractLabel } from "@/lib/format/contract-label";
import { formatDateWeb } from "@/lib/format/web";
import { setLastUsedView } from "@/lib/preferences/actions";
import type { AssetRecord } from "../actions";
import type { AssetComponentTreeNode } from "../components-actions";
import { draftFromAsset, emptyDraft, type AssetDraft } from "./asset-draft";
import { createAssetFromDraft, buildAssetSchema, saveAssetEdits } from "./asset-form-schema";
import { ASSET_DETAIL_VIEW_KEY } from "./constants";
import { AssetOverviewCards, type AssetReferenceLists } from "./asset-overview-cards";
import { AssetRail } from "./asset-rail";
import { buildAssetTimeline } from "./asset-timeline";
import { AssetContractsPanel } from "./asset-contracts-panel";
import { AssetStructurePanel, hasStructure, structureInfo, structureSize } from "./asset-structure-panel";
import { getLivePanel } from "./asset-live-panel";
import { AssetContractsDialog } from "./asset-contracts-dialog";
import { AssetCompositeManageDialog } from "./asset-composite-manage-dialog";
import { AssetVolumesPanel } from "./asset-volumes-panel";
import { DeleteAssetDialog } from "./delete-asset-dialog";

export type AssetDetailTab = "overview" | "workOrders" | "activities" | "contracts" | "structure" | "volumes";

export interface AssetScreenProps {
  mode: "create" | "edit";

  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  /** Never render an edit affordance RLS would reject — a viewer with `read`/
   * `read_own` but no `update`/`update_own` gets no Edit button at all. */
  readOnly?: boolean;
  lockedClientId?: string;
  initialSiteId?: string;
  cancelHref?: string;

  // ---- edit-mode-only ----
  canDelete?: boolean;
  canCreateActivityFromAsset?: boolean;
  /** `can(actor, "planning", "create")` + module visible — gates "+ Work order". */
  canCreateWorkOrder?: boolean;
  /** `null` = the module is not entitled / not readable: its tab and every
   * figure derived from it are hidden. */
  workOrders?: WorkOrderRecord[] | null;
  activities?: ActivityRecord[] | null;
  contractCoverage?: AssetContractCoverage[] | null;
  /** The composition tree this asset is part of (`null` = none). */
  tree?: AssetComponentTreeNode | null;
  /** Volumes tab data (issue #221); null/absent = the actor cannot read
   * asset volumes, so the tab does not render at all. */
  volumes?: AssetVolumesData | null;
  defaultTab?: AssetDetailTab;
}

/**
 * The single shared screen behind `/assets/new` (`mode: "create"`) and
 * `/assets/[id]` / `/assets/[id]/edit` (`mode: "edit"`) on the web design
 * system (issue #222), built exactly like the Client page:
 *
 *  - `PageHeader`: breadcrumb, human title (brand + model, falling back to the
 *    asset ID), badges (status → warnings → type → facts → ID, max 5), ONE
 *    Edit button (omitted without update permission; Overview only), the ···
 *    menu (Delete), the navy primary action ("New activity") and tabs with
 *    counts;
 *  - centre: the active tab — Overview (ONE two-column Details card + Notes;
 *    no related-list previews — those live only in their own tab) or a related list (Work orders,
 *    Activities, Contracts, Volumes), each a card + FilterBar + table, and
 *    Structure (the composition as a StructureTree);
 *  - rail: [LivePanel] · Context · Warranty & contract · Structure (only when
 *    part of a structure) · TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateAsset` / `createAsset`
 * actions (RBAC and RLS untouched). `mode: "create"` is the same page in new
 * mode: Overview only, "After creating" rail, gold "Create asset".
 */
export function AssetScreen({
  mode,
  asset,
  client = null,
  site = null,
  readOnly,
  lockedClientId,
  initialSiteId,
  cancelHref,
  canDelete,
  canCreateActivityFromAsset,
  canCreateWorkOrder,
  workOrders = null,
  activities = null,
  contractCoverage = null,
  tree = null,
  volumes = null,
  defaultTab = "overview",
}: AssetScreenProps) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [tab, setTab] = useState<AssetDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [linkParent, setLinkParent] = useState<{ id: string; name: string } | null>(null);
  const [, startTransition] = useTransition();

  // ---- Reference data (fetched client-side, only for someone who can edit)
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [lockedClientRecord, setLockedClientRecord] = useState<ClientRecord | null>(null);
  const [types, setTypes] = useState<ReferenceListItemRecord[]>([]);
  const [statuses, setStatuses] = useState<ReferenceListItemRecord[]>([]);
  const [subtypes, setSubtypes] = useState<ReferenceListItemRecord[]>([]);
  const [brands, setBrands] = useState<ReferenceListItemRecord[]>([]);
  const [models, setModels] = useState<AssetModelRecord[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(!readOnly);

  useEffect(() => {
    // A `readOnly` viewer never sees an edit affordance — don't fetch what
    // can't render. Runs once on mount (this screen mounts fresh per route).
    if (readOnly) return;
    let cancelled = false;
    Promise.all([
      lockedClientId ? getClient(lockedClientId) : Promise.resolve(null),
      lockedClientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      listReferenceItems("asset_type"),
      listReferenceItems("asset_status"),
      listReferenceItems("asset_subtype"),
      listReferenceItems("asset_brand"),
      listAssetModels(),
    ])
      .then(([lockedResult, clientsResult, typesResult, statusesResult, subtypesResult, brandsResult, modelsResult]) => {
        if (cancelled) return;
        setLockedClientRecord(lockedResult?.data?.client ?? null);
        setClients(clientsResult?.data?.clients ?? []);
        setTypes(typesResult.data?.items ?? []);
        setStatuses(statusesResult.data?.items ?? []);
        setSubtypes(subtypesResult.data?.items ?? []);
        setBrands(brandsResult.data?.items ?? []);
        setModels(modelsResult.data?.models ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lists = useMemo<AssetReferenceLists>(() => {
    const resolvedClients = lockedClientId
      ? lockedClientRecord
        ? [lockedClientRecord]
        : client
          ? [client]
          : []
      : clients;
    return { clients: resolvedClients, types, subtypes, statuses, brands, models };
  }, [lockedClientId, lockedClientRecord, client, clients, types, subtypes, statuses, brands, models]);

  // ---- Edit mode ------------------------------------------------------------
  const record = useMemo<AssetDraft>(
    () => (asset ? draftFromAsset(asset) : emptyDraft({ lockedClientId, initialSiteId })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset],
  );
  const sitesRef = useRef<SiteRecord[]>([]);
  const schema = useMemo(
    () =>
      buildAssetSchema({
        isNew: isCreate,
        labelFor: (key, id) => {
          switch (key) {
            case "clientId":
              return lists.clients.find((item) => item.id === id)?.name ?? "";
            case "siteId": {
              const found = sitesRef.current.find((item) => item.id === id) ?? (site?.id === id ? site : null);
              return found ? (formatSiteAddressShort(found) ?? "") : "";
            }
            case "typeId":
              return lists.types.find((item) => item.id === id)?.label ?? "";
            case "subtypeId":
              return lists.subtypes.find((item) => item.id === id)?.label ?? "";
            case "brandItemId":
              return lists.brands.find((item) => item.id === id)?.label ?? "";
            case "statusId":
              return lists.statuses.find((item) => item.id === id)?.label ?? "";
            case "modelId": {
              const model = lists.models.find((item) => item.id === id);
              return model ? [model.brand?.label, model.name].filter(Boolean).join(" ") : "";
            }
          }
        },
      }),
    [lists, site, isCreate],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<AssetDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && !readOnly,
    idPrefix: "asset",
    firstFieldKey: isCreate ? "modelId" : "name",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/assets"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/assets/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, assetId } = await createAssetFromDraft(draft);
        if (!result.ok || !assetId) return result;
        createdIdRef.current = assetId;
        toast({ title: "Asset created", tone: "success", duration: 3000 });
        router.push(`/assets/${assetId}`);
        return { ok: true };
      }
      return saveAssetEdits(asset!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // Status is required: a new asset starts on the organization's default
  // status (the user can change it).
  useEffect(() => {
    if (!isCreate || loadingOptions) return;
    const defaultStatus = statuses.find((item) => item.is_default);
    if (defaultStatus && !edit.draft.statusId) edit.setValue("statusId", defaultStatus.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, loadingOptions, statuses]);

  // Sites of the draft's client (follows the Client select).
  const clientScoped = useClientScopedLists(edit.draft.clientId, !readOnly);
  sitesRef.current = clientScoped.sites;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const savedModel = saved.modelId ? models.find((item) => item.id === saved.modelId) : undefined;
  const brandLabel =
    brands.find((item) => item.id === saved.brandItemId)?.label ??
    (saved.brandItemId === asset?.brand_item_id ? asset?.asset_brand?.label : undefined);
  const modelLabel = savedModel
    ? [savedModel.brand?.label, savedModel.name].filter(Boolean).join(" ")
    : saved.modelId && saved.modelId === asset?.model_id
      ? [brandLabel, asset.asset_model?.name].filter(Boolean).join(" ")
      : "";
  const typeLabel =
    types.find((item) => item.id === saved.typeId)?.label ?? (saved.typeId === asset?.type_id ? asset?.asset_type?.label : "");
  const subtypeLabel =
    subtypes.find((item) => item.id === saved.subtypeId)?.label ??
    (saved.subtypeId === asset?.subtype_id ? asset?.asset_subtype?.label : "");
  const status =
    statuses.find((item) => item.id === saved.statusId) ??
    (saved.statusId === asset?.status_id ? asset?.asset_status : null);
  const savedSite =
    clientScoped.sites.find((item) => item.id === saved.siteId) ?? (site?.id === saved.siteId ? site : null);
  const savedClientRecord = lists.clients.find((item) => item.id === saved.clientId) ?? client;

  const openWorkOrders = useMemo(
    () => (workOrders ?? []).filter((order) => !CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "")),
    [workOrders],
  );
  // Structure tab: when the asset is part of a composite structure, or when the
  // user may start one (link a first component).
  const structureCount = useMemo(() => structureSize(tree), [tree]);
  const structure = useMemo(() => structureInfo(tree), [tree]);
  const showStructureTab = !isCreate && (hasStructure(tree) || (!readOnly && Boolean(asset)));
  const livePanel = useMemo(() => getLivePanel(asset, null), [asset]);

  const timeline = useMemo(
    () =>
      asset
        ? buildAssetTimeline({ asset, activities, workOrders, volumes })
        : [],
    [asset, activities, workOrders, volumes],
  );

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: AssetDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(ASSET_DETAIL_VIEW_KEY, next);
    });
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(isCreate
        ? []
        : [
            ...(workOrders
              ? [
                  openWorkOrders.length > 0
                    ? { id: "workOrders", label: "Work orders", count: openWorkOrders.length, attention: "open" }
                    : { id: "workOrders", label: "Work orders", count: workOrders.length },
                ]
              : []),
            ...(activities ? [{ id: "activities", label: "Activities", count: activities.length }] : []),
            ...(contractCoverage ? [{ id: "contracts", label: "Contracts", count: contractCoverage.length }] : []),
            ...(showStructureTab ? [{ id: "structure", label: "Structure", count: structureCount }] : []),
            ...(volumes ? [{ id: "volumes", label: "Volumes" }] : []),
          ]),
    ],
    [isCreate, workOrders, openWorkOrders, activities, contractCoverage, showStructureTab, structureCount, volumes],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Header ---------------------------------------------------------------
  const title = isCreate ? "New asset" : modelLabel || asset?.name || "Asset";

  const badges: PageHeaderBadge[] = [];
  if (!isCreate) {
    if (status) {
      badges.push({ label: status.label, variant: toneFromColor(status.color) as WebBadgeVariant });
    }
    if (workOrders && openWorkOrders.length > 0) {
      badges.push({
        label: `${openWorkOrders.length} open ${openWorkOrders.length === 1 ? "work order" : "work orders"}`,
        variant: "warning",
      });
    }
    if (contractCoverage && contractCoverage.length === 0) badges.push({ label: "No contract", variant: "warning" });
    const typeText = [typeLabel, subtypeLabel].filter(Boolean).join(" / ");
    if (typeText) badges.push({ label: typeText });
    if (saved.warrantyUntil) badges.push({ label: `Warranty until ${formatDateWeb(saved.warrantyUntil)}` });
    if (asset && asset.name !== title) badges.push({ label: asset.name, variant: "mono" });
  }

  const overflow: WebMenuItem[] = [];
  if (canDelete && asset) {
    overflow.push({ key: "delete", label: "Delete asset", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  const newActivityHref = asset ? `/activities/new?assetId=${asset.id}` : undefined;
  const primary =
    canCreateActivityFromAsset && newActivityHref ? (
      <WebLinkButton href={newActivityHref} variant="primary">
        New activity
      </WebLinkButton>
    ) : undefined;

  const breadcrumb = isCreate
    ? lockedClientId && client
      ? [{ label: "Clients", href: "/clients" }, { label: client.name, href: `/clients/${client.id}` }, { label: "New asset" }]
      : [{ label: "Assets", href: "/assets" }, { label: "New asset" }]
    : [{ label: "Assets", href: "/assets" }, { label: asset?.name ?? "Asset", mono: true }];

  const header = (
    <PageHeader
      breadcrumb={breadcrumb}
      title={title}
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: !isCreate && !readOnly && tab === "overview",
        onEdit: edit.startEdit,
        overflow,
        primary,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: isCreate ? "Create asset" : "Save",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as AssetDetailTab)}
      tabsLabel="Asset sections"
      editStatus={edit.status}
    />
  );

  // ---- Rail -----------------------------------------------------------------
  const firstContract = contractCoverage?.[0]?.contract ?? null;
  const warrantyTerm = (() => {
    if (savedModel) return savedModel.default_warranty_months;
    if (saved.installedAt && saved.warrantyUntil) {
      const from = new Date(`${saved.installedAt}T00:00:00`);
      const to = new Date(`${saved.warrantyUntil}T00:00:00`);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from) {
        return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()));
      }
    }
    return asset?.asset_model?.default_warranty_months ?? null;
  })();

  const rail = isCreate ? (
    <SidebarSection title="After creating">
      <p className="web-rail-empty">
        The asset opens on its own page. Add readings, contracts, components and work orders from the tabs there.
      </p>
    </SidebarSection>
  ) : (
    <AssetRail
      client={savedClientRecord ? { id: savedClientRecord.id, name: savedClientRecord.name } : null}
      siteLabel={savedSite ? (formatSiteAddressShort(savedSite) ?? "Unnamed site") : null}
      modelLabel={modelLabel || null}
      contracts={
        contractCoverage
          ? {
              first: firstContract ? (
                <Link href={`/contracts/${firstContract.id}`}>{contractLabel(firstContract)}</Link>
              ) : null,
              extra: Math.max(0, contractCoverage.length - 1),
              formLabel: firstContract?.contract_type?.label ?? null,
            }
          : null
      }
      onManageContracts={contractCoverage ? () => selectTab("contracts") : undefined}
      warranty={{ until: saved.warrantyUntil || null, termMonths: warrantyTerm, installedAt: saved.installedAt || null }}
      structure={structure ? { ...structure, onShow: () => selectTab("structure") } : null}
      livePanel={livePanel}
    />
  );

  const ids = webTabIds(tab);
  const refresh = () => router.refresh();

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{
          items: timeline,
          emptyText: isCreate ? "The timeline starts once this record is created." : "No activity yet",
        }}
        locked={editing && !isCreate}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <div className="web-tab-stack">
            <AssetOverviewCards
              edit={edit}
              asset={asset}
              client={client}
              site={site}
              lists={lists}
              sites={clientScoped.sites}
              loadingOptions={loadingOptions}
              lockedClientId={lockedClientId}
              isNew={isCreate}
            />
          </div>
        )}

        {tab === "workOrders" && workOrders && asset && (
          <WorkOrdersPanel
            workOrders={workOrders}
            canCreate={Boolean(canCreateWorkOrder)}
            add={
              canCreateWorkOrder ? (
                <WebLinkButton
                  size="filter"
                  href={`/work-orders/new?clientId=${asset.client_id}&siteId=${asset.site_id}&assetId=${asset.id}`}
                >
                  + Work order
                </WebLinkButton>
              ) : undefined
            }
          />
        )}

        {tab === "activities" && activities && asset && (
          <ActivitiesPanel assetId={asset.id} activities={activities} canCreate={Boolean(canCreateActivityFromAsset)} />
        )}

        {tab === "contracts" && contractCoverage && asset && (
          <AssetContractsPanel
            coverage={contractCoverage}
            canManage={!readOnly}
            onLink={() => setContractsOpen(true)}
            onUnlink={(contractId) => {
              void unlinkContractAsset(contractId, asset.id).then((result) => {
                if (!result.data) {
                  toast({
                    title: "Contract not unlinked",
                    description: result.error ?? "Could not unlink this contract. Try again.",
                    tone: "danger",
                    duration: 6000,
                  });
                  return;
                }
                toast({ title: "Contract unlinked", duration: 3000 });
                refresh();
              });
            }}
          />
        )}

        {tab === "structure" && asset && (
          <AssetStructurePanel tree={tree} canManage={!readOnly} onLink={setLinkParent} onChange={refresh} />
        )}

        {tab === "volumes" && volumes && <AssetVolumesPanel volumes={volumes} />}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />

      {!isCreate && asset && deleteOpen && (
        <DeleteAssetDialog asset={asset} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
      {!isCreate && asset && contractsOpen && (
        <AssetContractsDialog
          open
          onOpenChange={setContractsOpen}
          assetId={asset.id}
          coverage={contractCoverage ?? []}
          loading={false}
          clientContracts={clientScoped.contracts}
          onChange={refresh}
        />
      )}
      {!isCreate && asset && !readOnly && linkParent && (
        <AssetCompositeManageDialog
          open
          onOpenChange={(open) => {
            if (!open) setLinkParent(null);
          }}
          parentAssetId={linkParent.id}
          parentAssetName={linkParent.name}
          onChange={refresh}
        />
      )}
    </WebPage>
  );
}

