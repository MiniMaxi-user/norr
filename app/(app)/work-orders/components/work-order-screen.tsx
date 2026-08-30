"use client";

import { useMemo } from "react";
import { Badge, Breadcrumbs, DetailHero, Stack, type BreadcrumbItem } from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { WorkOrderFields } from "./work-order-fields";
import { WorkOrderDetailActions } from "../[id]/work-order-detail-actions";
import { TimeEntriesPanel } from "../[id]/time-entries-panel";
import { ConsumedArticlesPanel } from "../[id]/consumed-articles-panel";
import { ChecklistPanel } from "../[id]/checklist-panel";
import type { TimeEntryRecord } from "../time-entries-actions";
import type { WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { WorkOrderChecklistItemRecord, WorkOrderChecklistRecord } from "../checklist-actions";

export interface WorkOrderScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` (locked-client variant for `create`,
   * plain "Work Orders / {title}" for `edit`) and pushed into the Topbar via
   * `usePageHeader` below — never rendered inline in the page body, matching
   * `client-detail.tsx`'s pattern. */
  breadcrumbItems: BreadcrumbItem[];

  // ---- WorkOrderFields passthrough (see that component's own prop docs) ----
  /** Required for `mode: "edit"`. */
  workOrder?: WorkOrderRecord;
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  asset?: AssetRecord | null;
  /** See `WorkOrderFields`' own `contract` prop doc comment (issue #100) —
   * passed straight through, unmodified. */
  contract?: ContractRecord | null;
  assignedMember?: OrgMemberRecord | null;
  readOnly?: boolean;
  clients: ClientRecord[];
  lockedClientId?: string;
  initialSiteId?: string;
  initialAssetId?: string;
  sourceActivityId?: string;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  members: OrgMemberRecord[];
  cancelHref?: string;

  // ---- edit-mode-only: hero actions + Time Entries/Checklist panels ----
  /** `can(actor, "planning", "delete")` — gates the hero's Delete action, and
   * is reused as-is for `TimeEntriesPanel`'s own `canDelete` (see that
   * component's doc comment for why). Unused in `mode: "create"`. */
  canDelete?: boolean;
  currentUserId?: string;
  timeEntries?: TimeEntryRecord[];
  timeEntryTypes?: ReferenceListItemRecord[];
  canLogTimeForOthers?: boolean;
  canUpdateTimeEntriesAny?: boolean;
  canUpdateTimeEntriesOwn?: boolean;
  /** `listWorkOrderArticles(workOrder.id)`'s result — the work order's own
   * consumed articles, see `ConsumedArticlesPanel`'s own doc comment. */
  workOrderArticles?: WorkOrderArticleRecord[];
  /** `listArticlesForSelect()`'s result — every active article, for the
   * consumed-article picker. */
  articlesForSelect?: ArticleSelectOption[];
  /** `canAny(actor, "planning", ["create", "create_own"])` — see
   * `ConsumedArticlesPanel`'s own doc comment for why this is a single gate,
   * unlike Time Entries' `canLogTimeForOthers`. */
  canCreateWorkOrderArticles?: boolean;
  canUpdateWorkOrderArticlesAny?: boolean;
  canUpdateWorkOrderArticlesOwn?: boolean;
  /** `hasFeature(org, "quotes") && canAccessModule(actor, "quotes") &&
   * can(actor, "quotes", "create")` — gates the hero's "Maak Quote" action
   * (issue #94). */
  canCreateQuote?: boolean;
  /** `hasFeature(org, "checklists") && canAccessModule(actor, "checklists")`
   * — gates whether `ChecklistPanel` renders at all (a separately-entitled
   * module, not folded into `planning`). */
  canAccessChecklists?: boolean;
  checklist?: WorkOrderChecklistRecord | null;
  checklistItems?: WorkOrderChecklistItemRecord[];
  checklistTemplates?: ChecklistTemplateRecord[];
  canAttachChecklist?: boolean;
  canDetachChecklist?: boolean;
  canUpdateChecklistAny?: boolean;
  canUpdateChecklistOwn?: boolean;
}

/**
 * The single shared screen behind both `/work-orders/new` (`mode: "create"`)
 * and the work order detail page (`mode: "edit"`) — genuinely one screen, not
 * two hand-maintained layouts. Both routes' `page.tsx` stay server components
 * doing their own data-fetching/RBAC gating (unchanged), and just render this
 * with `mode="create"|"edit"`.
 *
 * Header: the breadcrumb lives in the Topbar via `usePageHeader` (never an
 * inline `<Breadcrumbs>` in the page body — see `client-detail.tsx`'s own
 * doc comment on why the passed node must be memoized), and `DetailHero`
 * replaces the old plain `Heading`/`Toolbar`. `title` is "New werkorder" in
 * create mode, or the record's own (real) title in edit mode — never
 * genericized, per the explicit decision not to replace a saved record's
 * title with placeholder text. `badges` (the work order's status/priority)
 * and `actions` (`WorkOrderDetailActions`) only render in edit mode — there
 * is nothing saved yet to badge or act on in create mode.
 *
 * Below the hero: `WorkOrderFields` (both routes share the exact same
 * component/layout). *** Issue #100 *** gave `WorkOrderFields` its own
 * internal `DetailLayout` two-column split — fields as the main column, a
 * `WorkOrderRelationsRail` (Client/Site/Asset/Contract summary cards) as the
 * sticky rail — so that split lives inside `WorkOrderFields` itself (it owns
 * the client/site/asset/contract selection state the rail previews live),
 * not here. Below that — edit mode only, since there's no `work_order_id`
 * yet in create mode — `TimeEntriesPanel`, `ConsumedArticlesPanel`
 * (issue #94), and `ChecklistPanel` follow in a plain full-width vertical
 * `Stack`, outside `WorkOrderFields`' own rail split (they're sub-resource
 * panels, not part of the record's own field/relation layout).
 */
export function WorkOrderScreen({
  mode,
  breadcrumbItems,
  workOrder,
  client,
  site,
  asset,
  contract,
  assignedMember,
  readOnly,
  clients,
  lockedClientId,
  initialSiteId,
  initialAssetId,
  sourceActivityId,
  statuses,
  priorities,
  members,
  cancelHref,
  canDelete,
  currentUserId,
  timeEntries,
  timeEntryTypes,
  canLogTimeForOthers,
  canUpdateTimeEntriesAny,
  canUpdateTimeEntriesOwn,
  workOrderArticles,
  articlesForSelect,
  canCreateWorkOrderArticles,
  canUpdateWorkOrderArticlesAny,
  canUpdateWorkOrderArticlesOwn,
  canCreateQuote,
  canAccessChecklists,
  checklist,
  checklistItems,
  checklistTemplates,
  canAttachChecklist,
  canDetachChecklist,
  canUpdateChecklistAny,
  canUpdateChecklistOwn,
}: WorkOrderScreenProps) {
  // Referentially stable per `usePageHeader`'s own doc-comment warning — see
  // `client-detail.tsx`'s identical `breadcrumbNode` pattern.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const isEdit = mode === "edit" && Boolean(workOrder);

  return (
    <Stack gap="lg">
      <DetailHero
        avatarLabel={isEdit ? workOrder!.title : "New werkorder"}
        title={isEdit ? workOrder!.title : "New werkorder"}
        badges={
          isEdit ? (
            <>
              <Badge color={workOrder!.work_order_status?.color} variant="muted">
                {workOrder!.work_order_status?.label ?? "—"}
              </Badge>
              {workOrder!.work_order_priority && (
                <Badge color={workOrder!.work_order_priority.color} variant="muted">
                  {workOrder!.work_order_priority.label}
                </Badge>
              )}
            </>
          ) : undefined
        }
        actions={
          isEdit ? (
            <WorkOrderDetailActions
              workOrder={workOrder!}
              canDelete={Boolean(canDelete)}
              canCreateQuote={Boolean(canCreateQuote)}
            />
          ) : undefined
        }
      />

      <WorkOrderFields
        mode={mode}
        workOrder={workOrder}
        client={client}
        site={site}
        asset={asset}
        contract={contract}
        assignedMember={assignedMember}
        readOnly={readOnly}
        clients={clients}
        lockedClientId={lockedClientId}
        initialSiteId={initialSiteId}
        initialAssetId={initialAssetId}
        sourceActivityId={sourceActivityId}
        statuses={statuses}
        priorities={priorities}
        members={members}
        cancelHref={cancelHref}
      />

      {isEdit && (
        <>
          <TimeEntriesPanel
            workOrderId={workOrder!.id}
            timeEntries={timeEntries ?? []}
            members={members}
            entryTypes={timeEntryTypes ?? []}
            assignedTo={workOrder!.assigned_to}
            currentUserId={currentUserId!}
            canLogTimeForOthers={Boolean(canLogTimeForOthers)}
            canUpdateAny={Boolean(canUpdateTimeEntriesAny)}
            canUpdateOwn={Boolean(canUpdateTimeEntriesOwn)}
            canDelete={Boolean(canDelete)}
          />

          <ConsumedArticlesPanel
            workOrderId={workOrder!.id}
            workOrderArticles={workOrderArticles ?? []}
            articles={articlesForSelect ?? []}
            members={members}
            currentUserId={currentUserId!}
            canCreate={Boolean(canCreateWorkOrderArticles)}
            canUpdateAny={Boolean(canUpdateWorkOrderArticlesAny)}
            canUpdateOwn={Boolean(canUpdateWorkOrderArticlesOwn)}
            canDelete={Boolean(canDelete)}
          />

          {canAccessChecklists && (
            <ChecklistPanel
              workOrderId={workOrder!.id}
              checklist={checklist ?? null}
              items={checklistItems ?? []}
              templates={checklistTemplates ?? []}
              members={members}
              currentUserId={currentUserId!}
              canAttach={Boolean(canAttachChecklist)}
              canDetach={Boolean(canDetachChecklist)}
              canUpdateAny={Boolean(canUpdateChecklistAny)}
              canUpdateOwn={Boolean(canUpdateChecklistOwn)}
            />
          )}
        </>
      )}
    </Stack>
  );
}
