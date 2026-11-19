import { notFound } from "next/navigation";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { getWorkOrder } from "../actions";
import { isWorkOrderCheckedOutInField } from "../checkout-lock";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { getContract } from "@/app/(app)/contracts/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listChecklistTemplates } from "@/lib/checklist-templates/actions";
import { withTiming } from "@/lib/perf/timing";
import {
  getOrganizationTimeRoundingSettings,
  type OrganizationTimeRoundingSettings,
} from "@/app/(app)/settings/organization-time-rounding-actions";
import { listTimeEntries } from "../time-entries-actions";
import { listWorkOrderArticles } from "../work-order-articles-actions";
import { listWorkOrderPhotos } from "../photo-actions";
import { listWorkOrderVolumes } from "../volume-actions";
import { getWorkOrderChecklist } from "../checklist-actions";
import { getWorkOrderCostSummary, getUnresolvedWorkOrderTimeEntries } from "../quote-sync-actions";
import { WORK_ORDER_DETAIL_VIEW_KEY } from "../components/constants";
import { WorkOrderScreen, type WorkOrderDetailTab } from "../components/work-order-screen";

const TAB_IDS: WorkOrderDetailTab[] = ["overview", "hours", "materials", "photos", "volumes", "checklist"];

/** Fallback no-op rule when the org's rounding settings cannot be read. */
const DEFAULT_TIME_ROUNDING_SETTINGS: OrganizationTimeRoundingSettings = {
  travel: { minimumMinutes: null, roundingMinutes: null, direction: "up" },
  work: { minimumMinutes: null, roundingMinutes: null, direction: "up" },
};

export const metadata = { title: "Work Order" };

interface WorkOrderDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=hours` etc. deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Work order detail page — renders the shared `WorkOrderScreen`
 * (`../components/work-order-screen.tsx`, `mode="edit"`) on the web design
 * system (issue #222); `/work-orders/new` renders the same screen in
 * `mode="create"`. Overview + Hours / Material / Checklist tabs.
 *
 * Every tab's data is fetched here in ONE parallel round (the three former
 * Suspense slots are gone: the rail's LivePanel, the tab counters and the
 * timeline all need hours/material/checklist, so they cannot stream in behind
 * the header any more; `loading.tsx` is the shaped skeleton while this
 * resolves). Each list is only requested when the actor may see it — same
 * "don't fetch what can't render" rule as before — and the checklist tab does
 * not exist at all unless the org is entitled to the `checklists` module.
 *
 * Checkout lock (issue #203), the review-approval gate, entitlement checks and
 * every per-sub-entity permission flag are computed exactly as before; see the
 * comments on each below.
 */
export default async function WorkOrderDetailPage({ params, searchParams }: WorkOrderDetailPageProps) {
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();

  const workOrderResult = await getWorkOrder(id);
  if (!workOrderResult.data) notFound();
  const workOrder = workOrderResult.data.workOrder;

  // Checkout lock (issue #203, tightened 2026-09-19) — UI-only read-only
  // treatment mirroring the server-side guard `updateWorkOrder`/
  // `deleteWorkOrder` (`../actions.ts`) already enforce via
  // `isWorkOrderCheckedOutInField` (`../checkout-lock.ts`): a BOUNDED window,
  // `checkout` through `in_progress` only — NOT the Planning board's own
  // unbounded `isWorkOrderCheckedOutOrLater` (that one stays locked all the
  // way through `invoiced`, see that function's own doc comment for why
  // these are two separate checks). While genuinely still out in the field,
  // a planner/owner can no longer edit or delete this work order, or its
  // Hours/Material sub-entities, or turn it into a Quote. Once the work
  // order reaches `to_review` (sent back for office review), `completed`, or
  // `invoiced`, this is `false` again — the office can correct it, same as
  // the server-side guard now allows. Gated on `can(actor, "planning",
  // "update")` — the FULL path, not `update_own` — to mirror
  // `updateWorkOrder`'s own exact distinction: an engineer editing their OWN
  // assigned work order (only ever `update_own`) is exempt, same as
  // server-side.
  const isCheckedOutInField = await isWorkOrderCheckedOutInField(workOrder.status_id);
  const locked = isCheckedOutInField && can(actor, "planning", "update");

  // "Approve" (office review gate, product feedback, 2026-09-18 — see
  // `approveWorkOrderReview`'s own doc comment in `../actions.ts`). No longer
  // implies `locked` above (since 2026-09-19's tightening, `to_review` is
  // NOT checked-out-in-field — the office can edit the work order at this
  // point, that's the actual purpose of the review step) — this is simply
  // the one extra action available at exactly this one status, for the same
  // `can(actor, "planning", "update")` population, surfaced next to the
  // status badge in the hero regardless of whether the lock icon is showing.
  const canApproveReview = can(actor, "planning", "update") && workOrder.work_order_status?.value === "to_review";

  // Checklists (issue #14) are their own, separately-entitled module (NOT
  // folded into `planning` — see `lib/rbac/permissions.ts`'s `checklists`
  // row doc comment), so per CLAUDE.md rule 3 / docs/ARCHITECTURE.md
  // "Feature flags" the section must not render at all when the org isn't
  // entitled to it or this role has no access at all to the module — not
  // merely be shown disabled. This is independent of the page's own
  // `planning` gate above.
  const checklistsEnabled = await hasFeature(session.organization, "checklists");
  const canAccessChecklists = checklistsEnabled && canAccessModule(actor, "checklists");
  const canAttachChecklist = canAccessChecklists && can(actor, "checklists", "create");

  // Computed ahead of the fetches below (rather than alongside the other
  // permission booleans further down) so `canEdit` can gate which of the
  // interactive-form-only lists (clients/statuses/priorities) are actually
  // worth fetching — a `finance`/`administratie` viewer (`readOnly` per
  // `WorkOrderFields` below) never renders a single picker, so there is
  // nothing for those lists to populate.
  const canEdit = canAny(actor, "planning", ["update", "update_own"]);
  // Consumed Articles (issue #94) — same gate `createWorkOrderArticle` itself
  // enforces; used ahead of the fetch below to skip `listArticlesForSelect()`
  // entirely for a caller who could never render its picker anyway. `&&
  // !isCheckedOutInField` (issue #203 follow-up, tightened 2026-09-18 after
  // qa-reviewer caught this using `locked` — `locked` is owner/planner-scoped
  // (mirrors `updateWorkOrder`'s own engineer-`update_own` exemption), but
  // this gate also covers an engineer's OWN `create_own` path, and the
  // server-side guard `createWorkOrderArticle` (`../work-order-articles-
  // actions.ts`) now enforces the lock unconditionally, with NO role
  // exemption — so the UI gate must be role-agnostic too, or an engineer's
  // own checked-out work order would still show a live "+ Article" button
  // that unconditionally fails server-side).
  const canCreateWorkOrderArticles = canAny(actor, "planning", ["create", "create_own"]) && !isCheckedOutInField;
  // "Maak Quote" (issue #94) — mirrors `createQuoteFromWorkOrder`'s own gate
  // in `../create-quote-actions.ts` exactly: a separately-entitled module
  // (`quotes`) AND `can(actor, "quotes", "create")` (owner/planner only).
  const quotesEnabled = await hasFeature(session.organization, "quotes");
  const canCreateQuote = quotesEnabled && canAccessModule(actor, "quotes") && can(actor, "quotes", "create") && !locked;
  // Issue #109 — gates the "To invoice" KPI tile's real total, the Hours
  // section's per-bucket cost figures, and the "N entries missing rate"
  // warning. Mirrors `getWorkOrderCostSummary`/`getUnresolvedWorkOrderTimeEntries`'s
  // own gate in `../quote-sync-actions.ts` exactly (`can(actor, "planning",
  // "read")` — an engineer never satisfies this, only `read_own` — AND
  // `canAny(actor, "quotes", ["read"])`), used to skip both round trips
  // entirely (inside `work-order-hours-slot.tsx`) for an engineer, same
  // "don't fetch what can't render" precedent every other conditional fetch
  // in this file already follows.
  const canSeeCosts = quotesEnabled && can(actor, "planning", "read") && canAny(actor, "quotes", ["read"]);

  // Volumes (issues #221/#225): rides on the `assets` entitlement + `asset_volumes` read.
  const canReadVolumes =
    (await hasFeature(session.organization, "assets")) &&
    canAccessModule(actor, "assets") &&
    can(actor, "asset_volumes", "read");

  // Everything the page needs, in one parallel round (timed as one stage,
  // issue #150). Lists the actor cannot render are never requested.
  const [
    clientResult,
    assetResult,
    contractResult,
    membersResult,
    clientsResult,
    statusesResult,
    prioritiesResult,
    typesResult,
    timeEntriesResult,
    timeEntryTypesResult,
    costSummaryResult,
    unresolvedTimeEntriesResult,
    timeRoundingResult,
    workOrderArticlesResult,
    articlesForSelectResult,
    checklistResult,
    checklistTemplatesResult,
    photosResult,
    volumesResult,
    lastUsedTab,
  ] = await withTiming("work-order-detail:fetch", () =>
    Promise.all([
      getClient(workOrder.client_id),
      workOrder.asset_id ? getAsset(workOrder.asset_id) : Promise.resolve(null),
      // Full contract record (issue #100) — the work order's own `contract`
      // embed is deliberately thin (id/number only).
      workOrder.contract_id ? getContract(workOrder.contract_id) : Promise.resolve(null),
      listOrgMembers(),
      // Pickers of the edit form — skipped for a read-only viewer.
      canEdit ? listClients({ limit: 200 }) : Promise.resolve(null),
      canEdit ? listReferenceItems("work_order_status") : Promise.resolve(null),
      canEdit ? listReferenceItems("work_order_priority") : Promise.resolve(null),
      // Issue #164 (Planning module) — reuses the `activity_type` list rather
      // than a separate `work_order_type` one, see `../schema.ts`.
      canEdit ? listReferenceItems("activity_type") : Promise.resolve(null),
      // Hours tab (issue #15/#109/#198).
      listTimeEntries(workOrder.id),
      listReferenceItems("time_entry_type"),
      canSeeCosts ? getWorkOrderCostSummary(workOrder.id) : Promise.resolve(null),
      canSeeCosts ? getUnresolvedWorkOrderTimeEntries(workOrder.id) : Promise.resolve(null),
      getOrganizationTimeRoundingSettings(),
      // Material tab (issue #94) — the article picker only for someone who can log.
      listWorkOrderArticles(workOrder.id),
      canCreateWorkOrderArticles ? listArticlesForSelect() : Promise.resolve(null),
      // Checklist tab (issue #14) — own module, only when entitled.
      canAccessChecklists ? getWorkOrderChecklist(workOrder.id) : Promise.resolve(null),
      canAttachChecklist ? listChecklistTemplates() : Promise.resolve(null),
      // Photos tab (issue #224) — signed URLs, rides on `planning` read/read_own.
      listWorkOrderPhotos(workOrder.id),
      // Volumes tab (issues #221/#225): own `assets` entitlement + `asset_volumes` read.
      canReadVolumes ? listWorkOrderVolumes(workOrder.id) : Promise.resolve(null),
      preferencesStore.getLastUsedView(session.userId, WORK_ORDER_DETAIL_VIEW_KEY),
    ]),
  );

  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === workOrder.site_id) ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const contract = contractResult?.data?.contract ?? null;
  const members = membersResult.data?.members ?? [];
  const clients = clientsResult?.data?.clients ?? [];
  const statuses = statusesResult?.data?.items ?? [];
  const priorities = prioritiesResult?.data?.items ?? [];
  const types = typesResult?.data?.items ?? [];

  // `&& !locked` (issue #203) hides the hero's own Delete button AND the
  // Hours/Material sections' own row-level delete in one place — `canDelete`
  // is reused as-is for both below, same "one gate, several call sites"
  // precedent the next comment already establishes.
  const canDelete = can(actor, "planning", "delete") && !locked;
  // Time Entries (issue #15) share the `planning` module's own actions —
  // see time-entries-panel.tsx's module comment for why `canDelete` above is
  // reused as-is (owner/planner CRUD on `planning` implies both Work Orders
  // and their Time Entries sub-resource).
  //
  // Plain `create` (owner/planner) only — the manual Travel/Work "Add" entry
  // rows let picking WHICH engineer the entry belongs to, which only a
  // caller who can actually log on someone else's behalf may exercise (see
  // `createTimeEntry`'s own on-behalf-of logic in `time-entries-actions.ts`).
  // `&& !locked` (issue #203 follow-up) mirrors `canUpdateTimeEntriesAny`
  // below: once checked out, the PWA is the sole place to log a new time
  // entry too, same as editing an existing one — no role exemption, matching
  // the server-side guard `createTimeEntry`/`clockIn` (`../time-entries-
  // actions.ts`) now enforces unconditionally once checked-out-or-later.
  const canLogTimeForOthers = can(actor, "planning", "create") && !locked;
  // `&& !locked` (issue #203) hides the planner/owner "edit any entry"
  // affordance once checked out. `canUpdateTimeEntriesOwn` (the engineer's
  // own path) is `&& !isCheckedOutInField` — NOT `locked` — since 2026-09-18
  // (qa-reviewer caught the original "deliberately left untouched, mirroring
  // updateWorkOrder's exemption" reasoning as wrong for this sub-resource:
  // `updateWorkOrder` itself genuinely exempts an engineer's own `update_own`
  // row, but `updateTimeEntry`'s server-side guard, once checked out, has NO
  // such exemption — it blocks every caller. The UI gate has to match that.
  const canUpdateTimeEntriesAny = can(actor, "planning", "update") && !locked;
  const canUpdateTimeEntriesOwn = can(actor, "planning", "update_own") && !isCheckedOutInField;

  // Consumed Articles (issue #94) — same `planning` module, see
  // `consumed-articles-panel.tsx`'s own doc comment for why there is only one
  // create gate here (`canCreateWorkOrderArticles`, computed above) rather
  // than a further `canLogTimeForOthers`-style split. `&& !locked` mirrors
  // `canUpdateTimeEntriesAny` above for the same reason; `canUpdateWorkOrder-
  // ArticlesOwn` mirrors `canUpdateTimeEntriesOwn`'s `!isCheckedOutInField`
  // fix above for the same reason (`updateWorkOrderArticle`'s server-side
  // guard has no role exemption either).
  const canUpdateWorkOrderArticlesAny = can(actor, "planning", "update") && !locked;
  const canUpdateWorkOrderArticlesOwn = can(actor, "planning", "update_own") && !isCheckedOutInField;

  // Checklists (issue #14) are their OWN module (see comment above), not a
  // reuse of `planning`'s actions/permissions.
  const canDetachChecklist = canAccessChecklists && can(actor, "checklists", "delete");
  const canUpdateChecklistAny = canAccessChecklists && can(actor, "checklists", "update");
  const canUpdateChecklistOwn = canAccessChecklists && can(actor, "checklists", "update_own");

  // "Create quote" is the step AFTER the office review (approve moves the work
  // order to `completed`), so it is offered as a LivePanel action only then,
  // and only while no real (non-auto-draft) quote exists for it yet. The
  // query runs under the caller's RLS, only for someone who may create one.
  // Once the quote exists, the LivePanel links to it instead (same status).
  let quoteReady = false;
  let createdQuote: { id: string; name: string | null } | null = null;
  const canReadQuotes = quotesEnabled && canAccessModule(actor, "quotes");
  if (canReadQuotes && workOrder.work_order_status?.value === "completed") {
    const supabase = await createSupabaseServerClient();
    const { data: existingQuote } = await supabase
      .from("quotes")
      .select("id, name")
      .eq("work_order_id", workOrder.id)
      .eq("is_auto_draft", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; name: string | null }>();
    if (existingQuote) createdQuote = { id: existingQuote.id, name: existingQuote.name };
    quoteReady = canCreateQuote && !existingQuote;
  }

  const timeEntries = timeEntriesResult.data?.timeEntries ?? [];
  const costSummary = costSummaryResult?.data ?? null;
  const unresolvedTimeEntryCount = unresolvedTimeEntriesResult?.data?.unresolvedTimeEntryIds.length ?? 0;
  const workOrderArticles = workOrderArticlesResult.data?.workOrderArticles ?? [];

  // `?tab=` (explicit deep link) beats the last-used-view cookie; either
  // falls back to Overview when that tab does not exist for this actor.
  const available = (tab: string | null | undefined): WorkOrderDetailTab | null => {
    if (!tab || !TAB_IDS.includes(tab as WorkOrderDetailTab)) return null;
    return tab === "checklist" && !canAccessChecklists ? null : (tab as WorkOrderDetailTab);
  };

  return (
    <WorkOrderScreen
      key={workOrder.updated_at}
      mode="edit"
      breadcrumbItems={[{ label: "Work Orders", href: "/work-orders" }, { label: workOrder.work_order_number, mono: true }]}
      workOrder={workOrder}
      readOnly={!canEdit || locked}
      locked={locked}
      client={client}
      site={site}
      asset={asset}
      contract={contract}
      clients={clients}
      statuses={statuses}
      priorities={priorities}
      types={types}
      members={members}
      canDelete={canDelete}
      currentUserId={session.userId}
      canCreateQuote={quoteReady}
      createdQuote={createdQuote}
      canApproveReview={canApproveReview}
      defaultTab={available(requestedTab) ?? available(lastUsedTab) ?? "overview"}
      hours={{
        timeEntries,
        entryTypes: timeEntryTypesResult.data?.items ?? [],
        roundingSettings: timeRoundingResult.data?.settings ?? DEFAULT_TIME_ROUNDING_SETTINGS,
        costSummary,
        unresolvedTimeEntryCount,
        canSeeCosts,
        canLogTimeForOthers,
        canUpdateAny: canUpdateTimeEntriesAny,
        canUpdateOwn: canUpdateTimeEntriesOwn,
        checkedOut: isCheckedOutInField,
      }}
      material={{
        workOrderArticles,
        articles: articlesForSelectResult?.data?.articles ?? [],
        canCreate: canCreateWorkOrderArticles,
        canUpdateAny: canUpdateWorkOrderArticlesAny,
        canUpdateOwn: canUpdateWorkOrderArticlesOwn,
      }}
      photos={photosResult.data?.photos ?? null}
      volumes={
        volumesResult?.data && (volumesResult.data.readings.length > 0 || volumesResult.data.hasConfiguredCounters)
          ? volumesResult.data.readings
          : null
      }
      checklistData={
        canAccessChecklists
          ? {
              checklist: checklistResult?.data?.checklist ?? null,
              items: checklistResult?.data?.items ?? [],
              templates: checklistTemplatesResult?.data?.templates ?? [],
              canAttach: canAttachChecklist,
              canDetach: canDetachChecklist,
              canUpdateAny: canUpdateChecklistAny,
              canUpdateOwn: canUpdateChecklistOwn,
            }
          : null
      }
    />
  );
}
