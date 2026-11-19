"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import {
  WebButton,
  WebDetailLayout,
  WebPage,
  type WebBadgeVariant,
  type WebBreadcrumbItem,
} from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  WebConfirmDialog,
  PageHeader,
  scrollMainToTop,
  toneFromColor,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import { approveWorkOrderReview, type WorkOrderRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrganizationTimeRoundingSettings } from "@/app/(app)/settings/organization-time-rounding-actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { contractLabel } from "@/lib/format/contract-label";
import { formatDateTimeWeb } from "@/lib/format/web";
import { setLastUsedView } from "@/lib/preferences/actions";
import { clockOut, type TimeEntryRecord } from "../time-entries-actions";
import type { WorkOrderCostSummary } from "../quote-sync-actions";
import type { WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { WorkOrderPhotoRecord } from "../photo-actions";
import type { WorkOrderVolumeReadingRecord } from "../volume-actions";
import type { WorkOrderChecklistItemRecord, WorkOrderChecklistRecord } from "../checklist-actions";
import { createQuoteFromWorkOrder } from "../create-quote-actions";
import { generateWorkReceipt } from "../work-receipt-actions";
import { DeleteWorkOrderDialog } from "./delete-work-order-dialog";
import { draftFromWorkOrder, emptyDraft, type WorkOrderDraft } from "./work-order-draft";
import { buildWorkOrderSchema, createWorkOrderFromDraft, saveWorkOrderEdits } from "./work-order-form-schema";
import { WorkOrderOverviewCards } from "./work-order-overview-cards";
import { WorkOrderHoursPanel } from "./work-order-hours-panel";
import { WorkOrderMaterialsPanel } from "./work-order-materials-panel";
import { WorkOrderChecklistPanel } from "./work-order-checklist-panel";
import { WorkOrderPhotosPanel } from "./work-order-photos-panel";
import { WorkOrderVolumesPanel } from "./work-order-volumes-panel";
import { WorkOrderReceiptsPanel, type WorkOrderReceiptsData } from "./work-order-receipts-panel";
import { WorkOrderRail } from "./work-order-rail";
import { buildWorkOrderTimeline } from "./work-order-timeline";
import { getLivePanel } from "./work-order-live-panel";
import { approvalBlockers } from "../approval-readiness";
import { useClientScopedLists } from "./use-client-scoped-lists";
import { WORK_ORDER_DETAIL_VIEW_KEY } from "./constants";

export type WorkOrderDetailTab = "overview" | "hours" | "materials" | "photos" | "volumes" | "receipts" | "checklist";

export interface WorkOrderHoursData {
  timeEntries: TimeEntryRecord[];
  entryTypes: ReferenceListItemRecord[];
  roundingSettings: OrganizationTimeRoundingSettings;
  costSummary: WorkOrderCostSummary | null;
  unresolvedTimeEntryCount: number;
  canSeeCosts: boolean;
  canLogTimeForOthers: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  /** `isWorkOrderCheckedOutInField` — role-agnostic "out in the field". */
  checkedOut: boolean;
}

export interface WorkOrderMaterialData {
  workOrderArticles: WorkOrderArticleRecord[];
  articles: ArticleSelectOption[];
  canCreate: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
}

export interface WorkOrderChecklistData {
  checklist: WorkOrderChecklistRecord | null;
  items: WorkOrderChecklistItemRecord[];
  templates: ChecklistTemplateRecord[];
  canAttach: boolean;
  canDetach: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
}

export interface WorkOrderScreenProps {
  mode: "create" | "edit";
  breadcrumbItems: WebBreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  workOrder?: WorkOrderRecord;
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  asset?: AssetRecord | null;
  contract?: ContractRecord | null;
  /** No update permission, or checked out in the field for a planner/owner:
   * the Edit button is omitted entirely. */
  readOnly?: boolean;
  /** Checked out in the field (issue #203) — explains WHY it is read-only. */
  locked?: boolean;
  clients: ClientRecord[];
  lockedClientId?: string;
  initialClientId?: string;
  initialSiteId?: string;
  initialAssetId?: string;
  initialContractId?: string;
  initialDescription?: string;
  initialExternalReference?: string;
  initialAssignedTo?: string;
  sourceActivityId?: string;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  types: ReferenceListItemRecord[];
  members: OrgMemberRecord[];
  cancelHref?: string;

  // ---- edit-mode only ----
  canDelete?: boolean;
  currentUserId?: string;
  canCreateQuote?: boolean;
  /** The quote made from this work order after approval, if any. */
  createdQuote?: { id: string; name: string | null } | null;
  canApproveReview?: boolean;
  hours?: WorkOrderHoursData | null;
  material?: WorkOrderMaterialData | null;
  /** `null` = the org is not entitled to checklists / no access: no tab. */
  checklistData?: WorkOrderChecklistData | null;
  /** Field photos (issue #224); `null` = viewer may not read them: no tab. */
  photos?: WorkOrderPhotoRecord[] | null;
  /** Meter readings on this work order (issues #221/#225); `null` = no tab. */
  volumes?: WorkOrderVolumeReadingRecord[] | null;
  /** Work receipts (issue #226); `null` = viewer may not read them: no tab. */
  receipts?: WorkOrderReceiptsData | null;
  /** Client signature from the field sign-off (issue #226). */
  signature?: { url: string; signedAt: string } | null;
  defaultTab?: WorkOrderDetailTab;
}

/** First line of the description is the human name of the job; the external
 * reference is the fallback, the number the last resort. */
function jobTitle(description: string, externalReference: string, number: string | undefined, isCreate: boolean) {
  if (isCreate) return "New work order";
  const line = description
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || externalReference.trim() || number || "Work order";
}

const STATUS_BADGE: Record<string, WebBadgeVariant> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
};

/**
 * The single shared screen behind `/work-orders/new` (`mode: "create"`) and
 * `/work-orders/[id]` (`mode: "edit"`) on the web design system (issue #222),
 * built like the Client and Asset pages:
 *
 *  - `PageHeader`: WO number (mono) in the breadcrumb, the human job
 *    description as title, badges (status → overdue / checked-out → priority →
 *    type → planned date), ONE Edit button (Overview only, omitted without
 *    permission), the ··· menu (Delete), the navy primary action ("Create
 *    quote"), the engineer as owner line, tabs with counts;
 *  - centre: Overview (ONE two-column Details card + Description / Notes /
 *    Solution — no related-list previews) or a related list, each a card +
 *    FilterBar + table: Hours (with figure tiles), Material, Checklist;
 *  - rail: [LivePanel] · Context · Object · TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateWorkOrder` /
 * `createWorkOrder` actions (RBAC, checkout lock, numbering and RLS
 * untouched). `mode: "create"` is the same page in new mode: Overview only,
 * gold "Create work order".
 */
export function WorkOrderScreen({
  mode,
  breadcrumbItems,
  workOrder,
  client = null,
  site = null,
  asset = null,
  contract = null,
  readOnly,
  locked,
  clients,
  lockedClientId,
  initialClientId,
  initialSiteId,
  initialAssetId,
  initialContractId,
  initialDescription,
  initialExternalReference,
  initialAssignedTo,
  sourceActivityId,
  statuses,
  priorities,
  types,
  members,
  cancelHref,
  canDelete,
  currentUserId,
  canCreateQuote,
  createdQuote = null,
  canApproveReview,
  hours = null,
  material = null,
  checklistData = null,
  photos = null,
  volumes = null,
  receipts = null,
  signature = null,
  defaultTab = "overview",
}: WorkOrderScreenProps) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [tab, setTab] = useState<WorkOrderDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [quotePending, startQuote] = useTransition();
  const [receiptConfirmOpen, setReceiptConfirmOpen] = useState(false);
  const [receiptPending, startReceipt] = useTransition();

  // ---- Edit mode ------------------------------------------------------------
  const record = useMemo<WorkOrderDraft>(
    () =>
      workOrder
        ? draftFromWorkOrder(workOrder)
        : emptyDraft({
            lockedClientId,
            initialClientId,
            initialSiteId,
            initialAssetId,
            initialContractId,
            initialDescription,
            initialExternalReference,
            initialAssignedTo,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workOrder],
  );

  // Labels for "Changed · was …" messages come from whatever is loaded.
  const scopedRef = useRef<ReturnType<typeof useClientScopedLists> | null>(null);
  const schema = useMemo(
    () =>
      buildWorkOrderSchema({
        labelFor: (key, id) => {
          switch (key) {
            case "clientId":
              return clients.find((item) => item.id === id)?.name ?? (client?.id === id ? client.name : "");
            case "siteId": {
              const found = scopedRef.current?.sites.find((item) => item.id === id) ?? (site?.id === id ? site : null);
              return found ? (formatSiteAddressShort(found) ?? "") : "";
            }
            case "assetId":
              return scopedRef.current?.assets.find((item) => item.id === id)?.name ?? (asset?.id === id ? asset.name : "");
            case "contractId": {
              const found = scopedRef.current?.contracts.find((item) => item.id === id) ?? (contract?.id === id ? contract : null);
              return found ? contractLabel(found) : "";
            }
            case "assignedTo":
              return memberDisplayName(members.find((item) => item.id === id));
            case "statusId":
              return statuses.find((item) => item.id === id)?.label ?? "";
            case "priorityId":
              return priorities.find((item) => item.id === id)?.label ?? "";
            case "typeId":
              return types.find((item) => item.id === id)?.label ?? "";
          }
        },
      }),
    [clients, client, site, asset, contract, members, statuses, priorities, types],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<WorkOrderDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && !readOnly,
    idPrefix: "wo",
    firstFieldKey: isCreate ? (lockedClientId ? "description" : "clientId") : "priorityId",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/work-orders"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/work-orders/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, workOrderId } = await createWorkOrderFromDraft(draft, sourceActivityId);
        if (!result.ok || !workOrderId) return result;
        createdIdRef.current = workOrderId;
        toast({ title: "Work order created", tone: "success", duration: 3000 });
        router.push(`/work-orders/${workOrderId}`);
        return { ok: true };
      }
      return saveWorkOrderEdits(workOrder!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // Sites/assets/contracts of the draft's client — only fetched while editing
  // (read mode renders from the records the server already resolved).
  const clientScoped = useClientScopedLists(edit.draft.clientId, editing);
  scopedRef.current = clientScoped;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const status = statuses.find((item) => item.id === saved.statusId) ?? (saved.statusId === workOrder?.status_id ? workOrder?.work_order_status : null);
  const priority =
    priorities.find((item) => item.id === saved.priorityId) ??
    (saved.priorityId === workOrder?.priority_id ? workOrder?.work_order_priority : null);
  const typeItem = types.find((item) => item.id === saved.typeId) ?? (saved.typeId === workOrder?.type_id ? workOrder?.work_order_type : null);
  const assignedMember = saved.assignedTo ? members.find((item) => item.id === saved.assignedTo) : undefined;

  const timeEntries = hours?.timeEntries ?? null;
  const timeline = useMemo(
    () =>
      workOrder
        ? buildWorkOrderTimeline({
            workOrder,
            members,
            timeEntries,
            articles: material?.workOrderArticles ?? null,
            checklistItems: checklistData?.items ?? null,
          })
        : [],
    [workOrder, members, timeEntries, material, checklistData],
  );

  const refresh = () => router.refresh();

  // ---- LivePanel ------------------------------------------------------------
  const canStop = (entry: TimeEntryRecord) =>
    Boolean(hours && (hours.canUpdateAny || (hours.canUpdateOwn && entry.user_id === currentUserId)));
  // Same wrap-up rules `approveWorkOrderReview` enforces server-side. Lists
  // the actor cannot see count as 0 here; the server still checks them.
  const blockers = workOrder
    ? approvalBlockers({
        description: workOrder.description,
        solution: workOrder.solution,
        typeId: workOrder.type_id,
        clientId: workOrder.client_id,
        siteId: workOrder.site_id,
        assetId: workOrder.asset_id,
        runningTimeEntries: (timeEntries ?? []).filter((entry) => !entry.ended_at).length,
        openChecklistItems: (checklistData?.items ?? []).filter((item) => !item.is_checked).length,
      })
    : [];
  const fieldsMissing = blockers.some((blocker) => /^(Add|Choose|Link) /.test(blocker));
  const runningMissing = blockers.some((blocker) => blocker.startsWith("Stop "));
  const checklistMissing = blockers.some((blocker) => blocker.startsWith("Tick "));
  const fixAction =
    fieldsMissing && !readOnly
      ? { label: "Edit", onClick: () => (tab === "overview" ? edit.startEdit() : (selectTab("overview"), edit.startEdit())) }
      : runningMissing && hours
        ? { label: "Open hours", onClick: () => selectTab("hours") }
        : checklistMissing && checklistData
          ? { label: "Open checklist", onClick: () => selectTab("checklist") }
          : null;

  const livePanel = useMemo(
    () =>
      workOrder
        ? getLivePanel(
            {
              workOrder,
              timeEntries,
              members,
              canStop,
              canApproveReview: Boolean(canApproveReview),
              approvalBlockers: blockers,
              fixAction,
              canCreateQuote: Boolean(canCreateQuote),
              createdQuote,
              creatingQuote: quotePending,
              onCreateQuote: handleCreateQuote,
              // A failed attempt (logged row without PDF) doesn't count.
              canGenerateReceipt: Boolean(
                receipts?.isApproved && receipts.canGenerate && !receipts.receipts.some((receipt) => receipt.pdfUrl),
              ),
              generatingReceipt: receiptPending,
              onGenerateReceipt: handleGenerateReceipt,
              onStop: (entry) => {
                void clockOut(entry.id).then((result) => {
                  if (!result.data) {
                    toast({ title: "Timer not stopped", description: result.error ?? "Could not stop this timer.", tone: "danger", duration: 6000 });
                    return;
                  }
                  toast({ title: "Timer stopped", duration: 3000 });
                  refresh();
                });
              },
              onApprove: () => {
                void approveWorkOrderReview(workOrder.id).then((result) => {
                  if (!result.data) {
                    toast({ title: "Not approved", description: result.error ?? "Could not approve this work order.", tone: "danger", duration: 6000 });
                    return;
                  }
                  toast({ title: "Work order approved", tone: "success", duration: 3000 });
                  refresh();
                });
              },
            },
            currentUserId ? { userId: currentUserId } : null,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workOrder, timeEntries, members, canApproveReview, canCreateQuote, createdQuote, quotePending, receipts, receiptPending, currentUserId, hours?.canUpdateAny, hours?.canUpdateOwn, blockers.join("|"), tab],
  );

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: WorkOrderDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(WORK_ORDER_DETAIL_VIEW_KEY, next);
    });
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(isCreate
        ? []
        : [
            ...(hours ? [{ id: "hours", label: "Hours", count: hours.timeEntries.length }] : []),
            ...(material ? [{ id: "materials", label: "Material", count: material.workOrderArticles.length }] : []),
            ...(photos ? [{ id: "photos", label: "Photos", count: photos.length }] : []),
            ...(volumes ? [{ id: "volumes", label: "Volumes", count: volumes.length }] : []),
            ...(receipts ? [{ id: "receipts", label: "Work receipts", count: receipts.receipts.length }] : []),
            ...(checklistData ? [{ id: "checklist", label: "Checklist", count: checklistData.items.length }] : []),
          ]),
    ],
    [isCreate, hours, material, photos, volumes, receipts, checklistData],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Header ---------------------------------------------------------------
  const title = jobTitle(saved.description, saved.externalReference, workOrder?.work_order_number, isCreate);

  const badges: PageHeaderBadge[] = [];
  if (!isCreate) {
    if (status) badges.push({ label: status.label, variant: STATUS_BADGE[toneFromColor(status.color)] ?? "neutral" });
    const notStarted = ["new", "scheduled"].includes(workOrder?.work_order_status?.value ?? "");
    if (workOrder?.scheduled_at && notStarted && new Date(workOrder.scheduled_at).getTime() < Date.now()) {
      badges.push({ label: "Overdue", variant: "danger" });
    }
    if (locked) badges.push({ label: "Checked out · read-only", variant: "warning" });
    if (volumes?.some((reading) => reading.needsReview)) {
      badges.push({ label: "Volume needs review", variant: "warning" });
    }
    if (priority) badges.push({ label: priority.label });
    if (typeItem) badges.push({ label: typeItem.label });
    if (workOrder?.scheduled_at) badges.push({ label: `Planned ${formatDateTimeWeb(workOrder.scheduled_at)}` });
  }

  const overflow: WebMenuItem[] = [];
  if (canDelete && workOrder) {
    overflow.push({ key: "delete", label: "Delete work order", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  function handleCreateQuote() {
    if (!workOrder) return;
    startQuote(async () => {
      const result = await createQuoteFromWorkOrder(workOrder.id);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not create a quote", description: result.error ?? "Something went wrong." });
        return;
      }
      const { quoteId, skippedTimeEntryIds } = result.data;
      if (skippedTimeEntryIds.length > 0) {
        toast({
          tone: "danger",
          title: "Some time entries were left off this quote",
          description: `${skippedTimeEntryIds.length} time ${skippedTimeEntryIds.length === 1 ? "entry" : "entries"} could not be priced (no rate configured for that engineer or client) and ${skippedTimeEntryIds.length === 1 ? "was" : "were"} not added to the quote. Set a rate under Settings > Team or on the client, then add ${skippedTimeEntryIds.length === 1 ? "it" : "them"} manually if needed.`,
          duration: 0,
        });
      } else {
        toast({ tone: "success", title: "Quote created", description: workOrder.work_order_number });
      }
      router.push(`/quotes/${quoteId}`);
    });
  }

  function handleGenerateReceipt() {
    if (!workOrder) return;
    startReceipt(async () => {
      const result = await generateWorkReceipt(workOrder.id);
      setReceiptConfirmOpen(false);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not generate the work receipt", description: result.error ?? "Something went wrong." });
        return;
      }
      toast({ tone: "success", title: "Work receipt generated", description: result.data.receipt.receiptNumber, duration: 4000 });
      selectTab("receipts");
      refresh();
    });
  }

  // Approving the review, creating the quote and generating the FIRST work
  // receipt are LivePanel actions ("ACTION NEEDED FROM YOU"). Once a receipt
  // exists, the navy primary offers a new version (after a confirmation).
  const latestReceipt = receipts?.receipts[0] ?? null;
  const hasGeneratedReceipt = Boolean(receipts?.receipts.some((receipt) => receipt.pdfUrl));
  const primary =
    !isCreate && receipts?.isApproved && receipts.canGenerate && hasGeneratedReceipt ? (
      <WebButton variant="primary" loading={receiptPending} onClick={() => setReceiptConfirmOpen(true)}>
        Generate new version
      </WebButton>
    ) : undefined;

  const header = (
    <PageHeader
      breadcrumb={breadcrumbItems}
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
        saveLabel: isCreate ? "Create work order" : "Save",
      }}
      owner={assignedMember ? { name: memberDisplayName(assignedMember), role: "Engineer" } : null}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as WorkOrderDetailTab)}
      tabsLabel="Work order sections"
      editStatus={edit.status}
    />
  );

  // ---- Rail -----------------------------------------------------------------
  const rail = isCreate ? (
    <p className="web-rail-empty" style={{ padding: "13px 16px" }}>
      Hours, material and the checklist open on the work order&apos;s own page once it is created.
    </p>
  ) : (
    <WorkOrderRail livePanel={livePanel} assetRecord={asset?.id === saved.assetId ? asset : null} />
  );

  const ids = webTabIds(tab);

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
          <WorkOrderOverviewCards
            edit={edit}
            workOrder={workOrder}
            client={client}
            site={site}
            asset={asset}
            contract={contract}
            clients={clients}
            clientScoped={clientScoped}
            statuses={statuses}
            priorities={priorities}
            types={types}
            members={members}
            lockedClientId={lockedClientId}
            isNew={isCreate}
            signature={signature}
            sourceActivityId={sourceActivityId}
          />
        )}

        {tab === "hours" && hours && workOrder && (
          <WorkOrderHoursPanel
            workOrderId={workOrder.id}
            timeEntries={hours.timeEntries}
            members={members}
            entryTypes={hours.entryTypes}
            assignedTo={workOrder.assigned_to}
            currentUserId={currentUserId}
            canLogTimeForOthers={hours.canLogTimeForOthers}
            canUpdateAny={hours.canUpdateAny}
            canUpdateOwn={hours.canUpdateOwn}
            canDelete={Boolean(canDelete)}
            canSeeCosts={hours.canSeeCosts}
            costSummary={hours.costSummary}
            unresolvedTimeEntryCount={hours.unresolvedTimeEntryCount}
            roundingSettings={hours.roundingSettings}
            locked={hours.checkedOut}
          />
        )}

        {tab === "materials" && material && workOrder && (
          <WorkOrderMaterialsPanel
            workOrderId={workOrder.id}
            workOrderArticles={material.workOrderArticles}
            articles={material.articles}
            canCreate={material.canCreate}
            canUpdateAny={material.canUpdateAny}
            canUpdateOwn={material.canUpdateOwn}
            canDelete={Boolean(canDelete)}
            currentUserId={currentUserId}
            locked={hours?.checkedOut}
          />
        )}

        {tab === "photos" && photos && workOrder && <WorkOrderPhotosPanel photos={photos} />}
        {tab === "volumes" && volumes && workOrder && <WorkOrderVolumesPanel readings={volumes} />}

        {tab === "receipts" && receipts && workOrder && <WorkOrderReceiptsPanel data={receipts} workOrderId={workOrder.id} />}

        {tab === "checklist" && checklistData && workOrder && (
          <WorkOrderChecklistPanel
            workOrderId={workOrder.id}
            checklist={checklistData.checklist}
            items={checklistData.items}
            templates={checklistData.templates}
            currentUserId={currentUserId}
            canAttach={checklistData.canAttach}
            canDetach={checklistData.canDetach}
            canUpdateAny={checklistData.canUpdateAny}
            canUpdateOwn={checklistData.canUpdateOwn}
          />
        )}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />

      <WebConfirmDialog
        open={receiptConfirmOpen}
        title="Generate a new version?"
        confirmLabel="Generate new version"
        pending={receiptPending}
        onCancel={() => setReceiptConfirmOpen(false)}
        onConfirm={handleGenerateReceipt}
      >
        This creates version {(latestReceipt?.version ?? 0) + 1} of the work receipt; previous versions stay available.
      </WebConfirmDialog>

      {!isCreate && workOrder && deleteOpen && (
        <DeleteWorkOrderDialog workOrder={workOrder} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
    </WebPage>
  );
}
