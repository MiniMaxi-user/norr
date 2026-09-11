"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Breadcrumbs,
  Button,
  FormGrid,
  Skeleton,
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
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { formatDateTime } from "@/lib/format/date";
import { usePageHeader } from "@/components/shell/page-header-context";
import { WorkOrderDetailActions } from "../[id]/work-order-detail-actions";
import { WorkOrderHero } from "./work-order-hero";
import { WorkOrderHoursSection } from "./work-order-hours-section";
import { WorkOrderMaterialSection } from "./work-order-material-section";
import { WorkOrderChecklistSection } from "./work-order-checklist-section";
import { WorkOrderAssignmentSection } from "./work-order-assignment-section";
import { useClientScopedLists } from "./use-client-scoped-lists";
import { WorkOrderHeroStatsProvider, useWorkOrderHeroStatsValue } from "./work-order-hero-context";
import { draftFromWorkOrder, draftToInput, emptyDraft, type WorkOrderDraft } from "./work-order-draft";
import type { TimeEntryRecord } from "../time-entries-actions";
import type { WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { WorkOrderCostSummary } from "../quote-sync-actions";
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
  /** Issue #164 (Planning module) — the org's `activity_type` reference
   * items, for the Type `<Select>` folded into
   * `WorkOrderStatusPriorityDialog`. Reused from the same list Activities'
   * own type picker reads (see `../schema.ts`'s `workOrderCreateSchema.typeId`
   * doc comment). */
  types: ReferenceListItemRecord[];
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
  /** `can(actor, "planning", "read")` (issue #109) — gates BOTH the "To
   * invoice" KPI tile's real (material + travel + labor) total AND
   * `WorkOrderHoursSection`'s per-bucket cost figures / "N entries missing
   * rate" warning. False for an engineer (`planning`'s matrix row only
   * grants `read_own`) — see `[id]/page.tsx`'s own comment for why this is
   * computed once there and threaded through, same "don't fetch what can't
   * render" precedent `canCreateWorkOrderArticles` etc. already establish. */
  canSeeCosts?: boolean;
  /** `getWorkOrderCostSummary(workOrder.id)`'s result — only fetched by the
   * page when `canSeeCosts` is true. `null`/`undefined` (including every
   * `mode: "create"` render, which has no `workOrder.id` yet) falls back to
   * the pre-#109 material-only "To invoice" figure. */
  costSummary?: WorkOrderCostSummary | null;
  /** `getUnresolvedWorkOrderTimeEntries(workOrder.id)`'s
   * `unresolvedTimeEntryIds.length` — threaded straight through to
   * `WorkOrderHoursSection`'s warning `Callout`. */
  unresolvedTimeEntryCount?: number;
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

  // ---- edit-mode-only: streamed Hours/Material/Checklist (issue #146) ----
  /** `[id]/page.tsx`'s `<Suspense><WorkOrderHoursSlot .../></Suspense>` —
   * present in `mode: "edit"` only. When set, rendered in place of
   * `WorkOrderHoursSection` (whose own data — `timeEntries`/`costSummary`/
   * etc. above — the slot fetches and renders itself, streaming in
   * independently of the hero/relation cards); the `timeEntries` etc. props
   * above stay purely for `mode: "create"`'s always-synchronous local state.
   * See this component's own module doc comment for the full design. */
  hoursSlot?: ReactNode;
  /** `[id]/page.tsx`'s `<Suspense><WorkOrderMaterialSlot .../></Suspense>` —
   * same shape as `hoursSlot`, for `WorkOrderMaterialSection`. */
  materialSlot?: ReactNode;
  /** `[id]/page.tsx`'s `<Suspense><WorkOrderChecklistSlot .../></Suspense>` —
   * same shape as `hoursSlot`, for `WorkOrderChecklistSection`. Only ever set
   * alongside `canAccessChecklists`. */
  checklistSlot?: ReactNode;
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
 *
 * *** Issue #146 *** ("eliminate fetch waterfall, add below-fold Suspense
 * boundaries") changed HOW `mode: "edit"` gets Hours/Material/Checklist's own
 * data, without changing what's rendered: `[id]/page.tsx` no longer awaits a
 * 15-way `Promise.all` before rendering this component at all — it now
 * resolves only the hero/relation-card data up front, then passes
 * `hoursSlot`/`materialSlot`/`checklistSlot` (each a `<Suspense>`-wrapped
 * async Server Component that does that one section's own fetch) so the rest
 * of the page can stream in independently while the hero (and the Engineer
 * stat, resolved from the cheap `members` fetch) paints immediately. Those
 * three slots also feed the hero's Material/Checklist/"To invoice" stat-strip
 * tiles — data those tiles need but that's no longer fetched before first
 * paint — back up through `WorkOrderHeroStatsProvider`
 * (`work-order-hero-context.tsx`), the same "bridge state across a Suspense
 * boundary" shape `clients-hero-context.tsx` established for Clients' kanban
 * stats. `mode: "create"` is entirely unaffected — no slots exist there
 * (nothing to stream; every section's data is local, always-synchronous
 * draft state), so it keeps computing those same three tiles directly, exactly
 * as before this issue.
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
  types,
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
  canSeeCosts,
  costSummary = null,
  unresolvedTimeEntryCount = 0,
  canAccessChecklists,
  checklist = null,
  checklistItems = [],
  checklistTemplates = [],
  canAttachChecklist,
  canDetachChecklist,
  canUpdateChecklistAny,
  canUpdateChecklistOwn,
  hoursSlot,
  materialSlot,
  checklistSlot,
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

  // `WorkOrderHeroStatsProvider` wraps `WorkOrderScreenBody` (a sibling
  // function component below, NOT inlined here) because a React Context's
  // value is only visible to a `Provider`'s descendants — the component that
  // CREATES the `<Provider>` element can never itself read back out of it.
  // `WorkOrderScreenBody` is where the Material/Checklist/"To invoice" tiles
  // actually get assembled (`mode: "edit"` reads them from context, `mode:
  // "create"` still doesn't need it at all) — see this component's own
  // module doc comment ("Issue #146") for the full design.
  return (
    <WorkOrderHeroStatsProvider>
      <WorkOrderScreenBody
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
        types={types}
        readOnly={readOnly}
        members={members}
        currentUserId={currentUserId}
        canDelete={canDelete}
        canAccessChecklists={canAccessChecklists}
        hoursSlot={hoursSlot}
        materialSlot={materialSlot}
        checklistSlot={checklistSlot}
        heroActions={heroActions}
        onTitleChange={handleTitleChange}
        onTitleBlur={handleTitleBlur}
        onClientChange={setScopingClientId}
        onRelationsSave={commitPatch}
        onStatusPrioritySave={commitPatch}
        onAssignmentSave={commitPatch}
        createError={createError}
        timeEntries={timeEntries}
        timeEntryTypes={timeEntryTypes}
        canLogTimeForOthers={canLogTimeForOthers}
        canUpdateTimeEntriesAny={canUpdateTimeEntriesAny}
        canUpdateTimeEntriesOwn={canUpdateTimeEntriesOwn}
        workOrderArticles={workOrderArticles}
        articlesForSelect={articlesForSelect}
        canCreateWorkOrderArticles={canCreateWorkOrderArticles}
        canUpdateWorkOrderArticlesAny={canUpdateWorkOrderArticlesAny}
        canUpdateWorkOrderArticlesOwn={canUpdateWorkOrderArticlesOwn}
        canSeeCosts={canSeeCosts}
        costSummary={costSummary}
        unresolvedTimeEntryCount={unresolvedTimeEntryCount}
        checklist={checklist}
        checklistItems={checklistItems}
        checklistTemplates={checklistTemplates}
        canAttachChecklist={canAttachChecklist}
        canDetachChecklist={canDetachChecklist}
        canUpdateChecklistAny={canUpdateChecklistAny}
        canUpdateChecklistOwn={canUpdateChecklistOwn}
      />
    </WorkOrderHeroStatsProvider>
  );
}

interface WorkOrderScreenBodyProps {
  mode: "create" | "edit";
  draft: WorkOrderDraft;
  workOrder?: WorkOrderRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  asset: AssetRecord | null;
  contract: ContractRecord | null;
  clientScoped: ReturnType<typeof useClientScopedLists>;
  clients: ClientRecord[];
  lockedClientId?: string;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  types: ReferenceListItemRecord[];
  readOnly?: boolean;
  members: OrgMemberRecord[];
  currentUserId?: string;
  canDelete?: boolean;
  canAccessChecklists?: boolean;
  hoursSlot?: ReactNode;
  materialSlot?: ReactNode;
  checklistSlot?: ReactNode;
  heroActions: ReactNode;
  onTitleChange: (value: string) => void;
  onTitleBlur: (value: string) => void;
  onClientChange: (clientId: string) => void;
  /** All three of these are `WorkOrderScreen`'s own `commitPatch` — same
   * broad `Partial<WorkOrderDraft>` signature threaded through to `WorkOrderHero`'s
   * (narrower, `Pick<...>`) and `WorkOrderAssignmentSection`'s own prop types,
   * unchanged from before this file's issue #146 split. */
  onRelationsSave: (patch: Partial<WorkOrderDraft>) => Promise<{ ok: boolean; error?: string }>;
  onStatusPrioritySave: (patch: Partial<WorkOrderDraft>) => Promise<{ ok: boolean; error?: string }>;
  onAssignmentSave: (patch: Partial<WorkOrderDraft>) => Promise<{ ok: boolean; error?: string }>;
  createError: string | null;
  timeEntries: TimeEntryRecord[];
  timeEntryTypes: ReferenceListItemRecord[];
  canLogTimeForOthers?: boolean;
  canUpdateTimeEntriesAny?: boolean;
  canUpdateTimeEntriesOwn?: boolean;
  workOrderArticles: WorkOrderArticleRecord[];
  articlesForSelect: ArticleSelectOption[];
  canCreateWorkOrderArticles?: boolean;
  canUpdateWorkOrderArticlesAny?: boolean;
  canUpdateWorkOrderArticlesOwn?: boolean;
  canSeeCosts?: boolean;
  costSummary: WorkOrderCostSummary | null;
  unresolvedTimeEntryCount: number;
  checklist: WorkOrderChecklistRecord | null;
  checklistItems: WorkOrderChecklistItemRecord[];
  checklistTemplates: ChecklistTemplateRecord[];
  canAttachChecklist?: boolean;
  canDetachChecklist?: boolean;
  canUpdateChecklistAny?: boolean;
  canUpdateChecklistOwn?: boolean;
}

/**
 * The actual hero + Hours/Material/Checklist/Assignment layout — split out of
 * `WorkOrderScreen` itself purely so it can sit BELOW
 * `WorkOrderHeroStatsProvider` in the tree and read the Material/Checklist/
 * "To invoice" tiles back out of it via `useWorkOrderHeroStatsValue()` (issue
 * #146) — see that component's own doc comment. `mode: "create"` doesn't
 * touch that context at all (nothing ever reports into it — no slots exist in
 * that mode), so its three tiles are still built the old literal-placeholder
 * way right here.
 */
function WorkOrderScreenBody({
  mode,
  draft,
  workOrder,
  client,
  site,
  asset,
  contract,
  clientScoped,
  clients,
  lockedClientId,
  statuses,
  priorities,
  types,
  readOnly,
  members,
  currentUserId,
  canDelete,
  canAccessChecklists,
  hoursSlot,
  materialSlot,
  checklistSlot,
  heroActions,
  onTitleChange,
  onTitleBlur,
  onClientChange,
  onRelationsSave,
  onStatusPrioritySave,
  onAssignmentSave,
  createError,
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
  canSeeCosts,
  costSummary,
  unresolvedTimeEntryCount,
  checklist,
  checklistItems,
  checklistTemplates,
  canAttachChecklist,
  canDetachChecklist,
  canUpdateChecklistAny,
  canUpdateChecklistOwn,
}: WorkOrderScreenBodyProps) {
  const heroStats = useWorkOrderHeroStatsValue();

  const memberById = new Map(members.map((member) => [member.id, member]));
  const assignedMember = draft.assignedTo ? memberById.get(draft.assignedTo) : undefined;

  // Issue #106 reordered/replaced the strip: "Hours" (still visible as its
  // own section's own totals row, see `WorkOrderHoursSection`) no longer
  // gets a KPI tile of its own here — "To invoice" now takes its old FIRST
  // position — and the assigned engineer (previously a separate hero
  // `assignee` block, then briefly a read-out under the Hours header) now
  // takes "To invoice"'s old LAST position instead.
  const engineerStat: StatStripItem = {
    label: "Engineer",
    value: assignedMember ? memberDisplayName(assignedMember) : "Unassigned",
    hint: assignedMember
      ? draft.scheduledAt
        ? formatDateTime(draft.scheduledAt, { month: "long" })
        : "Not scheduled"
      : "No engineer assigned",
  };

  // *** Issue #146 *** `mode: "edit"`'s Material/Checklist/"To invoice"
  // figures now come from `heroStats` (populated by whichever of
  // `WorkOrderMaterialSlot`/`WorkOrderChecklistSlot`/`WorkOrderHoursSlot`'s
  // own reporter has resolved, see `work-order-hero-context.tsx`) instead of
  // being computed synchronously right here — a tile whose slot hasn't
  // streamed in yet renders a small `Skeleton` in place of its value rather
  // than blocking the whole hero. `mode: "create"` never populates that
  // context (no slots exist), so it keeps the exact literal
  // "—" / "Save the work order first" placeholders it always has.
  let materialStat: StatStripItem;
  let checklistStat: StatStripItem | undefined;
  let toInvoiceStat: StatStripItem;

  if (mode === "create") {
    materialStat = { label: "Material", value: "—", hint: "Save the work order first" };
    if (canAccessChecklists) {
      checklistStat = { label: "Checklist", value: "—", hint: "Save the work order first" };
    }
    toInvoiceStat = { label: "To invoice", value: "—", hint: "Save the work order first" };
  } else {
    materialStat = heroStats.materialStat ?? {
      label: "Material",
      value: <Skeleton height="1.1rem" width="3.5rem" />,
    };
    if (canAccessChecklists) {
      checklistStat = heroStats.checklistStat ?? {
        label: "Checklist",
        value: <Skeleton height="1.1rem" width="3.5rem" />,
      };
    }
    toInvoiceStat = heroStats.toInvoiceStat ?? {
      label: "To invoice",
      value: <Skeleton height="1.1rem" width="3.5rem" />,
    };
  }

  const stats: StatStripItem[] = [engineerStat, materialStat];
  if (checklistStat) stats.push(checklistStat);
  stats.push(toInvoiceStat);

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
        types={types}
        readOnly={readOnly}
        stats={stats}
        actions={heroActions}
        onTitleChange={onTitleChange}
        onTitleBlur={onTitleBlur}
        onClientChange={onClientChange}
        onRelationsSave={onRelationsSave}
        onStatusPrioritySave={onStatusPrioritySave}
      />

      <FormGrid columns={2}>
        {hoursSlot ?? (
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
            canSeeCosts={Boolean(canSeeCosts)}
            costSummary={costSummary}
            unresolvedTimeEntryCount={unresolvedTimeEntryCount}
          />
        )}
        {materialSlot ?? (
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
        )}
      </FormGrid>

      {canAccessChecklists ? (
        <FormGrid columns={2}>
          {checklistSlot ?? (
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
          )}
          <WorkOrderAssignmentSection
            mode={mode}
            draft={draft}
            workOrder={workOrder}
            members={members}
            readOnly={readOnly}
            onSave={onAssignmentSave}
          />
        </FormGrid>
      ) : (
        <WorkOrderAssignmentSection
          mode={mode}
          draft={draft}
          workOrder={workOrder}
          members={members}
          readOnly={readOnly}
          onSave={onAssignmentSave}
        />
      )}
    </Stack>
  );
}
