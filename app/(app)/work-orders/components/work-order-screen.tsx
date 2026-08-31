"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Breadcrumbs,
  Button,
  FormGrid,
  Stack,
  Text,
  type BreadcrumbItem,
  type StatStripItem,
} from "@yourorg/ui";
import { createWorkOrder, updateWorkOrder, type WorkOrderRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { formatCurrency } from "@/lib/format/currency";
import { usePageHeader } from "@/components/shell/page-header-context";
import { WorkOrderDetailActions } from "../[id]/work-order-detail-actions";
import { WorkOrderHero } from "./work-order-hero";
import { WorkOrderHoursSection } from "./work-order-hours-section";
import { WorkOrderMaterialSection } from "./work-order-material-section";
import { WorkOrderChecklistSection } from "./work-order-checklist-section";
import { WorkOrderAssignmentSection } from "./work-order-assignment-section";
import { useClientScopedLists } from "./use-client-scoped-lists";
import { draftFromWorkOrder, draftToInput, emptyDraft, type WorkOrderDraft } from "./work-order-draft";
import { elapsedMinutes, formatHoursMinutes } from "./format-work-order-time";
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

  /** Required for `mode: "edit"`. */
  workOrder?: WorkOrderRecord;
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  asset?: AssetRecord | null;
  contract?: ContractRecord | null;
  assignedMember?: OrgMemberRecord | null;
  readOnly?: boolean;
  clients: ClientRecord[];
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the client — e.g. `new/page.tsx`'s
   * activity-originated pre-fill (issue #102: "then everything known on the
   * activity gets filled in"), the activity's own `client_id`. Ignored when
   * `lockedClientId` is also set. */
  initialClientId?: string;
  initialSiteId?: string;
  initialAssetId?: string;
  /** Issue #106 — pre-fill from the new Overview "New work order" picker
   * dialog, which lets the contract be chosen up front alongside client/
   * site/asset. */
  initialContractId?: string;
  /** Same activity pre-fill as `initialClientId` — the activity's own
   * `description`, so `mode: "create"` doesn't start fully blank. */
  initialDescription?: string;
  /** Issue #103 — defaults the (still fully editable, see #6's title-input
   * fix) title to the source activity's own type label ("Storing"/
   * "Onderhoud"/…) instead of starting blank, since a blank title with no
   * visible affordance was exactly the bug users hit. */
  initialTitle?: string;
  /** Issue #103 — the source activity's own `action_holder_id` ("Behandelaar"),
   * pre-filling (never locking) `assignedTo` the same way `initialClientId`/
   * `initialAssetId` pre-fill without locking. The only other Activity field
   * with a direct Work Order equivalent — `ActivityRecord` has no
   * `site_id`/`priority_id`/`scheduled_at` of its own to carry over (see
   * `new/page.tsx`'s own doc comment). */
  initialAssignedTo?: string;
  sourceActivityId?: string;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  members: OrgMemberRecord[];
  cancelHref?: string;

  // ---- edit-mode-only: hero actions + Hours/Material/Checklist/Assignment ----
  /** `can(actor, "planning", "delete")` — gates the hero's Delete action, and
   * is reused as-is for the Hours/Material sections' own row-level delete
   * (see those components' doc comments for why). Unused in `mode: "create"`. */
  canDelete?: boolean;
  currentUserId?: string;
  timeEntries?: TimeEntryRecord[];
  timeEntryTypes?: ReferenceListItemRecord[];
  canLogTimeForOthers?: boolean;
  canUpdateTimeEntriesAny?: boolean;
  canUpdateTimeEntriesOwn?: boolean;
  /** `listWorkOrderArticles(workOrder.id)`'s result — the work order's own
   * consumed articles, see `WorkOrderMaterialSection`'s own doc comment. */
  workOrderArticles?: WorkOrderArticleRecord[];
  /** `listArticlesForSelect()`'s result — every active article, for the
   * consumed-article picker. */
  articlesForSelect?: ArticleSelectOption[];
  canCreateWorkOrderArticles?: boolean;
  canUpdateWorkOrderArticlesAny?: boolean;
  canUpdateWorkOrderArticlesOwn?: boolean;
  /** `hasFeature(org, "quotes") && canAccessModule(actor, "quotes") &&
   * can(actor, "quotes", "create")` — gates the hero's "Create Quote" action
   * (issue #94). */
  canCreateQuote?: boolean;
  /** `hasFeature(org, "checklists") && canAccessModule(actor, "checklists")`
   * — gates whether `WorkOrderChecklistSection` renders at all (a separately-
   * entitled module, not folded into `planning`). */
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
 * and the work order detail page (`mode: "edit"`) — one real screen, not two
 * (issue #102: "New workorder resulteert in 1 scherm! Bewerken opent ook dit
 * scherm."). Both routes' `page.tsx` stay server components doing their own
 * data-fetching/RBAC gating (unchanged), rendering this with
 * `mode="create"|"edit"`.
 *
 * *** Issue #102 redesign *** (revised by issue #103) replaces the old
 * `DetailHero` + `WorkOrderFields` (a plain vertical form) with:
 *  - `WorkOrderHero` — the full-bleed dark `RecordHeroBand` (title/badges/
 *    stat-strip) followed by the Client/Site/Asset/Contract relation cards in
 *    their own framed `Card` (issue #103 split these out of #102's original
 *    shared "sheet" — see `WorkOrderHero`'s own doc comment for why).
 *  - `WorkOrderHoursSection` / `WorkOrderMaterialSection` side by side
 *    ("Links uren rechts materiaal" per the issue), rendered directly on the
 *    page background with no `Card` frame of their own (issue #103).
 *  - `WorkOrderChecklistSection` / `WorkOrderAssignmentSection` side by side
 *    below that ("Daaronder checklist en opdracht"), same no-`Card` treatment.
 *
 * There is no single big `<form>` anymore. This component owns one flat
 * `WorkOrderDraft` (`./work-order-draft.ts`) as the source of truth for every
 * editable field; every section reads from it and writes back through
 * `commitPatch` below — in `mode: "edit"` that's an immediate
 * `updateWorkOrder` call (small, section-scoped popups, saved the instant
 * their own dialog's Save is clicked — no page-wide Save/Cancel), in
 * `mode: "create"` it's a local-only merge (nothing exists server-side yet)
 * until the hero's own "Create work order" action fires `createWorkOrder`
 * with the whole accumulated draft and navigates to the new record. This is
 * how a single screen serves both modes without a fake "empty" work order
 * being created just to get an id for Hours/Material/Checklist to attach to
 * — those three sections simply render their own "save the work order first"
 * empty/disabled state (see each one's own doc comment) until `mode: "edit"`.
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
  clients,
  lockedClientId,
  initialClientId,
  initialSiteId,
  initialAssetId,
  initialContractId,
  initialDescription,
  initialTitle,
  initialAssignedTo,
  sourceActivityId,
  statuses,
  priorities,
  members,
  cancelHref,
  canDelete,
  currentUserId,
  timeEntries = [],
  timeEntryTypes = [],
  canLogTimeForOthers,
  canUpdateTimeEntriesAny,
  canUpdateTimeEntriesOwn,
  workOrderArticles = [],
  articlesForSelect = [],
  canCreateWorkOrderArticles,
  canUpdateWorkOrderArticlesAny,
  canUpdateWorkOrderArticlesOwn,
  canCreateQuote,
  canAccessChecklists,
  checklist = null,
  checklistItems = [],
  checklistTemplates = [],
  canAttachChecklist,
  canDetachChecklist,
  canUpdateChecklistAny,
  canUpdateChecklistOwn,
}: WorkOrderScreenProps) {
  const router = useRouter();

  // Referentially stable per `usePageHeader`'s own doc-comment warning — see
  // `client-detail.tsx`'s identical `breadcrumbNode` pattern.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<WorkOrderDraft>(() =>
    workOrder
      ? draftFromWorkOrder(workOrder)
      : emptyDraft({
          lockedClientId,
          initialClientId,
          initialSiteId,
          initialAssetId,
          initialContractId,
          initialDescription,
          initialTitle,
          initialAssignedTo,
        }),
  );

  // The client currently being PREVIEWED for the relation cards + the
  // relations popup's own site/asset/contract pickers — kept separate from
  // `draft.clientId` so opening the popup and trying a different client
  // updates both live, without touching the actually-saved value until Save
  // is clicked. Self-heals back to `draft.clientId` the moment that value
  // legitimately changes (a real commit, or the dialog being cancelled).
  const [scopingClientId, setScopingClientId] = useState(draft.clientId);
  useEffect(() => {
    setScopingClientId(draft.clientId);
  }, [draft.clientId]);
  const clientScoped = useClientScopedLists(scopingClientId, !readOnly);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Every section's own "Save" ultimately calls this. `mode: "edit"` persists
   * immediately (`updateWorkOrder`) and refreshes the server-rendered data
   * (`router.refresh()`, same as the pre-redesign form); `mode: "create"`
   * only ever merges into local draft state (see this component's own module
   * doc comment for why). */
  async function commitPatch(patch: Partial<WorkOrderDraft>): Promise<{ ok: boolean; error?: string }> {
    if (mode === "edit" && workOrder) {
      const result = await updateWorkOrder(workOrder.id, draftToInput(patch));
      if (!result.data) return { ok: false, error: result.error };
      setDraft((prev) => ({ ...prev, ...patch }));
      router.refresh();
      return { ok: true };
    }
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  function handleTitleChange(value: string) {
    setDraft((prev) => ({ ...prev, title: value }));
  }

  function handleTitleBlur(value: string) {
    const trimmed = value.trim();
    if (mode === "edit" && workOrder && trimmed && trimmed !== workOrder.title) {
      void commitPatch({ title: trimmed });
    }
  }

  async function handleCreate() {
    if (!draft.title.trim()) {
      setCreateError("Title is required.");
      return;
    }
    if (!draft.clientId) {
      setCreateError("Select a client.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    // `sourceActivityId` (issue #87) is CREATE-only traceability, not part of
    // the editable `WorkOrderDraft` surface (see `new/page.tsx`'s own doc
    // comment) — merged straight into the create call instead.
    const result = await createWorkOrder({ ...draftToInput(draft), sourceActivityId });
    setCreating(false);
    if (!result.data) {
      setCreateError(result.error ?? "Could not create this work order.");
      return;
    }
    router.push(`/work-orders/${result.data.workOrder.id}`);
  }

  const travelWorkMinutes = timeEntries.reduce(
    (sum, entry) => sum + (elapsedMinutes(entry.started_at, entry.ended_at) ?? 0),
    0,
  );
  const materialTotal = workOrderArticles.reduce(
    (sum, row) => sum + row.quantity * (row.article?.sale_price ?? 0),
    0,
  );
  const checklistChecked = checklistItems.filter((item) => item.is_checked).length;

  const stats: StatStripItem[] = [
    {
      label: "Hours",
      value: mode === "create" ? "—" : formatHoursMinutes(travelWorkMinutes),
      hint: mode === "create" ? "Save the work order first" : `${timeEntries.length} ${timeEntries.length === 1 ? "entry" : "entries"}`,
    },
    {
      label: "Material",
      value: mode === "create" ? "—" : formatCurrency(materialTotal),
      hint: mode === "create" ? "Save the work order first" : `${workOrderArticles.length} ${workOrderArticles.length === 1 ? "article" : "articles"}`,
    },
  ];
  if (canAccessChecklists) {
    stats.push({
      label: "Checklist",
      value: mode === "create" ? "—" : checklist ? `${checklistChecked} / ${checklistItems.length}` : "—",
      progress:
        mode === "edit" && checklist && checklistItems.length > 0
          ? (checklistChecked / checklistItems.length) * 100
          : undefined,
      hint: mode === "create" ? "Save the work order first" : !checklist ? "Not attached" : undefined,
    });
  }
  // "To invoice" (mockup's "Te factureren") — material cost only, not hours +
  // material. Pricing an hour of logged time requires the same client ->
  // engineer rate-override resolution `create-quote-actions.ts` runs when it
  // actually creates a quote (rule precedence: client override, then
  // engineer override, then "no rate resolvable, left off"); duplicating
  // that here for a KPI tile risks silently disagreeing with the real quote
  // total, so this stays deliberately material-only and says so via `hint`
  // rather than showing a number that looks like the full invoice total but
  // isn't.
  stats.push({
    label: "To invoice",
    value: mode === "create" ? "—" : formatCurrency(materialTotal),
    hint: mode === "create" ? "Save the work order first" : "Material only — see Create Quote for the full total",
  });

  const heroActions =
    mode === "edit" && workOrder ? (
      <WorkOrderDetailActions workOrder={workOrder} canDelete={Boolean(canDelete)} canCreateQuote={Boolean(canCreateQuote)} />
    ) : (
      <>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(cancelHref ?? "/work-orders")}
          disabled={creating}
        >
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Creating…" : "Create work order"}
        </Button>
      </>
    );

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}

      <WorkOrderHero
        mode={mode}
        draft={draft}
        workOrder={workOrder}
        client={client}
        site={site}
        asset={asset}
        contract={contract}
        clientScoped={clientScoped}
        clients={clients}
        lockedClientId={lockedClientId}
        statuses={statuses}
        priorities={priorities}
        readOnly={readOnly}
        stats={stats}
        actions={heroActions}
        onTitleChange={handleTitleChange}
        onTitleBlur={handleTitleBlur}
        onClientChange={setScopingClientId}
        onRelationsSave={commitPatch}
        onStatusPrioritySave={commitPatch}
      />

      <FormGrid columns={2}>
        <WorkOrderHoursSection
          mode={mode}
          workOrderId={workOrder?.id}
          timeEntries={timeEntries}
          members={members}
          entryTypes={timeEntryTypes}
          assignedTo={draft.assignedTo}
          currentUserId={currentUserId}
          canLogTimeForOthers={Boolean(canLogTimeForOthers)}
          canUpdateAny={Boolean(canUpdateTimeEntriesAny)}
          canUpdateOwn={Boolean(canUpdateTimeEntriesOwn)}
          canDelete={Boolean(canDelete)}
        />
        <WorkOrderMaterialSection
          mode={mode}
          workOrderId={workOrder?.id}
          workOrderArticles={workOrderArticles}
          articles={articlesForSelect}
          canCreate={Boolean(canCreateWorkOrderArticles)}
          canUpdateAny={Boolean(canUpdateWorkOrderArticlesAny)}
          canUpdateOwn={Boolean(canUpdateWorkOrderArticlesOwn)}
          canDelete={Boolean(canDelete)}
          currentUserId={currentUserId}
        />
      </FormGrid>

      {canAccessChecklists ? (
        <FormGrid columns={2}>
          <WorkOrderChecklistSection
            mode={mode}
            workOrderId={workOrder?.id}
            checklist={checklist}
            items={checklistItems}
            templates={checklistTemplates}
            currentUserId={currentUserId}
            canAccess={Boolean(canAccessChecklists)}
            canAttach={Boolean(canAttachChecklist)}
            canDetach={Boolean(canDetachChecklist)}
            canUpdateAny={Boolean(canUpdateChecklistAny)}
            canUpdateOwn={Boolean(canUpdateChecklistOwn)}
          />
          <WorkOrderAssignmentSection
            mode={mode}
            draft={draft}
            workOrder={workOrder}
            members={members}
            readOnly={readOnly}
            onSave={commitPatch}
          />
        </FormGrid>
      ) : (
        <WorkOrderAssignmentSection
          mode={mode}
          draft={draft}
          workOrder={workOrder}
          members={members}
          readOnly={readOnly}
          onSave={commitPatch}
        />
      )}
    </Stack>
  );
}
