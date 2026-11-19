"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import {
  SidebarSection,
  WebButton,
  WebDetailLayout,
  WebPage,
  type WebBadgeVariant,
  type WebBreadcrumbItem,
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
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { setLastUsedView } from "@/lib/preferences/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ActivityRecord } from "../actions";
import type { ActivityEventRecord } from "../history-actions";
import type { ActivityNoteRecord } from "../notes-actions";
import type { SolutionSubtypeRecord } from "../solution-subtype-actions";
import { flattenSolutionSubtypes } from "../solution-subtype-tree";
import type { ActivitySubtypeRecord } from "../subtypes-actions";
import { flattenActivitySubtypes } from "../subtype-tree";
import { createWorkOrderFromActivity } from "../create-work-order-actions";
import { ACTIVITY_DETAIL_VIEW_KEY } from "./constants";
import { draftFromActivity, emptyDraft, type ActivityDraft } from "./activity-draft";
import { buildActivitySchema, createActivityFromDraft, saveActivityEdits } from "./activity-form-schema";
import { ActivityNotesPanel } from "./activity-notes-panel";
import { ActivityOverviewCards } from "./activity-overview-cards";
import { ActivityRail } from "./activity-rail";
import { buildActivityTimeline } from "./activity-timeline";
import { ActivityWorkOrdersPanel } from "./activity-work-orders-panel";
import { DeleteActivityDialog } from "./delete-activity-dialog";
import { useClientScopedActivityLists } from "./use-client-scoped-activity-lists";

export type ActivityDetailTab = "overview" | "notes" | "workorders";

export interface ActivityScreenProps {
  mode: "create" | "edit";
  breadcrumbItems: WebBreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  activity?: ActivityRecord;
  client?: ClientRecord | null;
  asset?: AssetRecord | null;
  /** No update permission: the Edit button is omitted entirely. */
  readOnly?: boolean;
  clients: ClientRecord[];
  activityTypes: ReferenceListItemRecord[];
  activityStatuses: ReferenceListItemRecord[];
  /** The org's whole flat Activity / Solution Subtype trees. */
  activitySubtypes: ActivitySubtypeRecord[];
  solutionSubtypes: SolutionSubtypeRecord[];
  members: OrgMemberRecord[];
  /** Locks Action holder to the caller (an engineer). */
  canAssignOthers: boolean;
  lockedClientId?: string;
  lockedAssetId?: string;
  /** `mode: "create"` only — pins Action holder for a caller who can't assign others. */
  initialActionHolderId?: string;
  cancelHref?: string;

  // ---- edit-mode only ----
  canDelete?: boolean;
  /** `can(actor, "planning", "create")`, gated behind the planning module. */
  canCreateWorkOrder?: boolean;
  /** `undefined` = the caller cannot read planning: no Work orders tab. */
  linkedWorkOrders?: WorkOrderRecord[];
  notes?: ActivityNoteRecord[];
  events?: ActivityEventRecord[];
  defaultTab?: ActivityDetailTab;
}

const STATUS_BADGE: Record<string, WebBadgeVariant> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
};

/** First line of the description is the human name of the activity. */
function activityTitle(description: string, typeLabel: string | undefined, isCreate: boolean) {
  if (isCreate) return "New activity";
  const line = description
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || typeLabel || "Activity";
}

/**
 * The single shared screen behind `/activities/new` (`mode: "create"`) and
 * `/activities/[id]` (`mode: "edit"`) on the web design system (issue #222),
 * built like the Work order and Article pages:
 *
 *  - `PageHeader`: activity number (mono) in the breadcrumb, the first line of the
 *    description as title, badges (status → type → activity subtype), ONE Edit
 *    button (Overview only, omitted without update permission), the ··· menu
 *    (Delete), the navy primary "Create work order" (with planning create
 *    permission; creates via `createWorkOrderFromActivity` and opens it) and
 *    tabs with counts, the action holder as owner line. No LivePanel: an
 *    activity has no deadline, SLA or timer;
 *  - centre: Overview (ONE two-column Details card + Description / Solution)
 *    or a related list: Notes (feed), Work orders (card + FilterBar + table);
 *  - rail: Reported · Object · TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateActivity` /
 * `createActivity` actions (RBAC, DB triggers and RLS untouched). `mode:
 * "create"` is the same page in new mode: Overview only, gold "Create
 * activity", pre-scoped through `?clientId=` / `?assetId=`.
 */
export function ActivityScreen({
  mode,
  breadcrumbItems,
  activity,
  client = null,
  asset = null,
  readOnly,
  clients,
  activityTypes,
  activityStatuses,
  activitySubtypes,
  solutionSubtypes,
  members,
  canAssignOthers,
  lockedClientId,
  lockedAssetId,
  initialActionHolderId,
  cancelHref,
  canDelete,
  canCreateWorkOrder,
  linkedWorkOrders,
  notes = [],
  events = [],
  defaultTab = "overview",
}: ActivityScreenProps) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [tab, setTab] = useState<ActivityDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [creatingWorkOrder, startCreatingWorkOrder] = useTransition();

  const flatActivitySubtypes = useMemo(() => flattenActivitySubtypes(activitySubtypes), [activitySubtypes]);
  const flatSolutionSubtypes = useMemo(() => flattenSolutionSubtypes(solutionSubtypes), [solutionSubtypes]);

  // ---- Edit mode ------------------------------------------------------------
  const record = useMemo<ActivityDraft>(
    () => (activity ? draftFromActivity(activity) : emptyDraft({ lockedClientId, lockedAssetId, initialActionHolderId })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity],
  );

  // Labels for "Changed · was …" messages come from whatever is loaded.
  const scopedRef = useRef<ReturnType<typeof useClientScopedActivityLists> | null>(null);
  const schema = useMemo(
    () =>
      buildActivitySchema({
        typeValueFor: (typeId) => activityTypes.find((item) => item.id === typeId)?.value ?? "",
        labelFor: (key, id) => {
          switch (key) {
            case "clientId":
              return clients.find((item) => item.id === id)?.name ?? (client?.id === id ? client.name : "");
            case "assetId":
              return scopedRef.current?.assets.find((item) => item.id === id)?.name ?? (asset?.id === id ? asset.name : "");
            case "typeId":
              return activityTypes.find((item) => item.id === id)?.label ?? "";
            case "statusId":
              return activityStatuses.find((item) => item.id === id)?.label ?? "";
            case "contactPersonId":
              return scopedRef.current?.contacts.find((item) => item.id === id)?.name ?? "";
            case "actionHolderId":
              return memberDisplayName(members.find((item) => item.id === id));
            case "activitySubtypeId":
              return flatActivitySubtypes.find((item) => item.id === id)?.path ?? "";
            case "solutionSubtypeId":
              return flatSolutionSubtypes.find((item) => item.id === id)?.path ?? "";
          }
        },
      }),
    [clients, client, asset, activityTypes, activityStatuses, members, flatActivitySubtypes, flatSolutionSubtypes],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<ActivityDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && !readOnly,
    idPrefix: "activity",
    firstFieldKey: isCreate ? (lockedClientId || lockedAssetId ? "typeId" : "clientId") : "statusId",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/activities"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/activities/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, activityId } = await createActivityFromDraft(draft);
        if (!result.ok || !activityId) return result;
        createdIdRef.current = activityId;
        toast({ title: "Activity created", tone: "success", duration: 3000 });
        router.push(`/activities/${activityId}`);
        return { ok: true };
      }
      return saveActivityEdits(activity!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // Assets/contacts/contracts of the draft's client.
  const clientScoped = useClientScopedActivityLists(edit.draft.clientId, editing);
  scopedRef.current = clientScoped;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const status =
    activityStatuses.find((item) => item.id === saved.statusId) ??
    (saved.statusId === activity?.status_id ? activity?.activity_status : null);
  const typeItem =
    activityTypes.find((item) => item.id === saved.typeId) ??
    (saved.typeId === activity?.type_id ? activity?.activity_type : null);
  const subtypeName = flatActivitySubtypes.find((item) => item.id === saved.activitySubtypeId)?.name ??
    (saved.activitySubtypeId === activity?.activity_subtype_id ? activity?.activity_subtype?.name : undefined);
  const holder = saved.actionHolderId ? members.find((item) => item.id === saved.actionHolderId) : undefined;
  const isDone = status?.value === "completed";

  const timeline = useMemo(() => (activity ? buildActivityTimeline({ events, notes }) : []), [activity, events, notes]);

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: ActivityDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(ACTIVITY_DETAIL_VIEW_KEY, next);
    });
  }

  const showNotesTab = !isCreate && Boolean(activity) && (!readOnly || notes.length > 0);
  const showWorkOrdersTab = !isCreate && linkedWorkOrders !== undefined;

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(showNotesTab ? [{ id: "notes", label: "Notes", count: notes.length }] : []),
      ...(showWorkOrdersTab ? [{ id: "workorders", label: "Work orders", count: linkedWorkOrders?.length ?? 0 }] : []),
    ],
    [showNotesTab, showWorkOrdersTab, notes.length, linkedWorkOrders],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Header ---------------------------------------------------------------
  const title = activityTitle(saved.description, typeItem?.label, isCreate);

  const badges: PageHeaderBadge[] = [];
  if (!isCreate) {
    if (status) badges.push({ label: status.label, variant: STATUS_BADGE[toneFromColor(status.color)] ?? "neutral" });
    if (typeItem) badges.push({ label: typeItem.label });
    if (subtypeName) badges.push({ label: subtypeName });
  }

  const overflow: WebMenuItem[] = [];
  if (canDelete && activity) {
    overflow.push({ key: "delete", label: "Delete activity", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  // Navy primary (read mode only): dispatch a work order from this activity
  // through the existing `createWorkOrderFromActivity`, then open it — same
  // spot as "New activity" on the Asset page.
  function createWorkOrder() {
    if (!activity) return;
    startCreatingWorkOrder(async () => {
      const result = await createWorkOrderFromActivity(activity.id);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not create a work order", description: result.error ?? "Something went wrong." });
        return;
      }
      toast({ tone: "success", title: "Work order created", description: result.data.workOrder.work_order_number });
      router.push(`/work-orders/${result.data.workOrder.id}`);
    });
  }
  const primary =
    !isCreate && activity && canCreateWorkOrder ? (
      <WebButton variant="primary" onClick={createWorkOrder} disabled={creatingWorkOrder}>
        {creatingWorkOrder ? "Creating…" : "Create work order"}
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
        saveLabel: isCreate ? "Create activity" : "Save",
      }}
      owner={holder ? { name: memberDisplayName(holder), role: "Action holder" } : null}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as ActivityDetailTab)}
      tabsLabel="Activity sections"
      editStatus={edit.status}
    />
  );

  // ---- Rail -----------------------------------------------------------------
  const rail =
    isCreate || !activity ? (
      <SidebarSection title="After creating">
        <p className="web-rail-empty">Notes and work orders open on the activity&apos;s own page once it is created.</p>
      </SidebarSection>
    ) : (
      <ActivityRail activity={activity} assetRecord={asset?.id === saved.assetId ? asset : null} isDone={isDone} />
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
          <ActivityOverviewCards
            edit={edit}
            activity={activity}
            client={client}
            asset={asset}
            clients={clients}
            clientScoped={clientScoped}
            activityTypes={activityTypes}
            activityStatuses={activityStatuses}
            activitySubtypes={flatActivitySubtypes}
            solutionSubtypes={flatSolutionSubtypes}
            members={members}
            canAssignOthers={canAssignOthers}
            lockedClientId={lockedClientId}
            lockedAssetId={lockedAssetId}
            isNew={isCreate}
          />
        )}

        {tab === "notes" && activity && showNotesTab && (
          <ActivityNotesPanel activityId={activity.id} notes={notes} readOnly={readOnly} />
        )}

        {tab === "workorders" && activity && showWorkOrdersTab && (
          <ActivityWorkOrdersPanel
            activityId={activity.id}
            workOrders={linkedWorkOrders ?? []}
            canCreate={Boolean(canCreateWorkOrder)}
          />
        )}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />

      {!isCreate && activity && deleteOpen && (
        <DeleteActivityDialog activity={activity} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
    </WebPage>
  );
}
