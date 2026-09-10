import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getWorkOrder } from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { getContract } from "@/app/(app)/contracts/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { WorkOrderScreen } from "../components/work-order-screen";
import {
  WorkOrderChecklistSectionSkeleton,
  WorkOrderHoursSectionSkeleton,
  WorkOrderMaterialSectionSkeleton,
} from "../components/work-order-section-skeletons";
import { WorkOrderHoursSlot } from "./work-order-hours-slot";
import { WorkOrderMaterialSlot } from "./work-order-material-slot";
import { WorkOrderChecklistSlot } from "./work-order-checklist-slot";

export const metadata = { title: "Edit Work Order" };

interface WorkOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Work order detail page — renders the same shared `WorkOrderScreen`
 * (`../components/work-order-screen.tsx`, `mode="edit"`) that
 * `/work-orders/new` renders with `mode="create"` — both routes are one
 * genuinely shared screen now, not two hand-maintained layouts. No `Tabs`
 * here: unlike Client (Sites/Assets/Contacts) or a future Contract, none of a
 * work order's child sub-entities (Hours/Time Entries, issue #15; Material/
 * Consumed Articles, issue #94; Checklist, issue #14) needs its own tab —
 * each is a single always-visible section (`WorkOrderHoursSection`,
 * `WorkOrderMaterialSection`, `WorkOrderChecklistSection`) rendered below the
 * hero, same reasoning `ContractAssetsPanel` documents for Contracts'
 * Linked Assets.
 *
 * *** Issue #89 ("New/Edit work order screens aligned") *** folded the
 * standalone `/work-orders/[id]/edit` page into this one — there is no
 * separate edit route left at all.
 *
 * *** Issue #102 ("Verbeteren workorder") *** redid the whole layout again,
 * replacing the old `DetailHero` + form-`Card`s shape with `WorkOrderScreen`'s
 * own composition: `WorkOrderHero` (dark `RecordHeroBand` + a KPI stat strip
 * + the Client/Site/Asset/Contract relation cards, each individually
 * re-pickable via a small Edit popup) up top, then Hours/Material side by
 * side, then Checklist/Assignment side by side. Every field is now edited
 * through small section-scoped popups (title is the one exception — an
 * inline-editable heading right in the hero) instead of one page-wide form —
 * see `WorkOrderScreen`'s own module doc comment for the full shape.
 * `contract` (fetched via `getContract` below, alongside `client`/`asset`)
 * exists purely to give the Contract relation card real facts (type/dates/
 * value), not just the bare id/name `workOrder.contract` embed already
 * carried.
 *
 * *** Issue #146 ("eliminate fetch waterfall, add below-fold Suspense
 * boundaries") *** replaced the old single 15-way `Promise.all` (which
 * blocked the ENTIRE page — hero included — on the slowest of Hours/
 * Material/Checklist/cost-summary data, with no `<Suspense>` anywhere) with
 * two tiers:
 *  1. A small `Promise.all` below of only the cheap, hero/relation-card-
 *     critical single-row/short-list lookups (`client`/`asset`/`contract`/
 *     `members`, plus the edit-only picker lists `clients`/`statuses`/
 *     `priorities`) — awaited, so the hero (title, relation cards, status/
 *     priority, and the Engineer stat tile, resolved from `members`) renders
 *     as soon as this resolves, without waiting on anything else.
 *  2. Three separate async Server Components (`work-order-hours-slot.tsx`/
 *     `-material-slot.tsx`/`-checklist-slot.tsx`), each doing exactly the
 *     fetches that section itself used to block on, each wrapped in its own
 *     `<Suspense>` below so they stream in independently of each other and of
 *     the hero. Because the hero's own stat strip needs the Material/
 *     Checklist/"To invoice" figures those same three slots fetch, those
 *     numbers are bridged back up via `WorkOrderHeroStatsProvider`
 *     (`work-order-hero-context.tsx`) instead of being fetched twice — see
 *     `WorkOrderScreen`'s own module doc comment for the full design
 *     rationale.
 *
 * Every RBAC/feature-flag gate below is unchanged from before this issue —
 * only WHEN each conditionally-fetched list is actually requested moved (from
 * this file's own `Promise.all` into the relevant slot component), never
 * whether it's requested at all.
 *
 * `readOnly` (exactly `!canEdit` below) hides every Edit affordance across
 * the hero/sections for a `finance`/`administratie` viewer (plain `read`) —
 * never a 404, never a disabled-but-technically-interactive control RLS
 * would just reject. `WorkOrderScreen` is keyed by `workOrder.updated_at` so
 * a successful inline save (which never navigates away — see that
 * component's own doc comment) remounts it with the freshly saved values
 * instead of leaving stale local draft state behind — including this page's
 * own three `Suspense` boundaries, which briefly show their skeleton fallback
 * again while the freshly-saved data streams back in, same as every other
 * section already re-fetches on save via `router.refresh()`.
 *
 * Photo/e-signature capture on the checklist remains out of scope per the
 * checklists migration's own design notes (a documented follow-up, not an
 * oversight).
 */
export default async function WorkOrderDetailPage({ params }: WorkOrderDetailPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();

  const workOrderResult = await getWorkOrder(id);
  if (!workOrderResult.data) notFound();
  const workOrder = workOrderResult.data.workOrder;

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
  // entirely for a caller who could never render its picker anyway.
  const canCreateWorkOrderArticles = canAny(actor, "planning", ["create", "create_own"]);
  // "Maak Quote" (issue #94) — mirrors `createQuoteFromWorkOrder`'s own gate
  // in `../create-quote-actions.ts` exactly: a separately-entitled module
  // (`quotes`) AND `can(actor, "quotes", "create")` (owner/planner only).
  const quotesEnabled = await hasFeature(session.organization, "quotes");
  const canCreateQuote = quotesEnabled && canAccessModule(actor, "quotes") && can(actor, "quotes", "create");
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

  const [clientResult, assetResult, contractResult, membersResult, clientsResult, statusesResult, prioritiesResult] =
    await Promise.all([
      getClient(workOrder.client_id),
      workOrder.asset_id ? getAsset(workOrder.asset_id) : Promise.resolve(null),
      // Full contract record (issue #100) — the work order's own `contract`
      // embed (`WORK_ORDER_SELECT` in `../actions.ts`) is deliberately thin
      // (id/name only), enough for a plain link but not for the rail's "a
      // couple of key facts" card; fetched the same "one extra round trip for
      // the full record" way `asset`/`client` already are.
      workOrder.contract_id ? getContract(workOrder.contract_id) : Promise.resolve(null),
      listOrgMembers(),
      // Client/Site/Asset/Contract pickers and the Status/Priority pickers
      // (`WorkOrderFields`, editable branch only) — skipped for a read-only
      // viewer, same "don't fetch what can't render" reasoning as every
      // conditional fetch below.
      canEdit ? listClients({ limit: 200 }) : Promise.resolve(null),
      canEdit ? listReferenceItems("work_order_status") : Promise.resolve(null),
      canEdit ? listReferenceItems("work_order_priority") : Promise.resolve(null),
    ]);

  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === workOrder.site_id) ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const contract = contractResult?.data?.contract ?? null;
  const members = membersResult.data?.members ?? [];
  const clients = clientsResult?.data?.clients ?? [];
  const statuses = statusesResult?.data?.items ?? [];
  const priorities = prioritiesResult?.data?.items ?? [];

  const canDelete = can(actor, "planning", "delete");
  // Time Entries (issue #15) share the `planning` module's own actions —
  // see time-entries-panel.tsx's module comment for why `canDelete` above is
  // reused as-is (owner/planner CRUD on `planning` implies both Work Orders
  // and their Time Entries sub-resource).
  //
  // Plain `create` (owner/planner) only — the manual Travel/Work "Add" entry
  // rows let picking WHICH engineer the entry belongs to, which only a
  // caller who can actually log on someone else's behalf may exercise (see
  // `createTimeEntry`'s own on-behalf-of logic in `time-entries-actions.ts`).
  const canLogTimeForOthers = can(actor, "planning", "create");
  const canUpdateTimeEntriesAny = can(actor, "planning", "update");
  const canUpdateTimeEntriesOwn = can(actor, "planning", "update_own");

  // Consumed Articles (issue #94) — same `planning` module, see
  // `consumed-articles-panel.tsx`'s own doc comment for why there is only one
  // create gate here (`canCreateWorkOrderArticles`, computed above) rather
  // than a further `canLogTimeForOthers`-style split.
  const canUpdateWorkOrderArticlesAny = can(actor, "planning", "update");
  const canUpdateWorkOrderArticlesOwn = can(actor, "planning", "update_own");

  // Checklists (issue #14) are their OWN module (see comment above), not a
  // reuse of `planning`'s actions/permissions.
  const canDetachChecklist = canAccessChecklists && can(actor, "checklists", "delete");
  const canUpdateChecklistAny = canAccessChecklists && can(actor, "checklists", "update");
  const canUpdateChecklistOwn = canAccessChecklists && can(actor, "checklists", "update_own");

  return (
    <WorkOrderScreen
      key={workOrder.updated_at}
      mode="edit"
      breadcrumbItems={[{ label: "Work Orders", href: "/work-orders" }, { label: workOrder.title }]}
      workOrder={workOrder}
      readOnly={!canEdit}
      client={client}
      site={site}
      asset={asset}
      contract={contract}
      clients={clients}
      statuses={statuses}
      priorities={priorities}
      members={members}
      canDelete={canDelete}
      currentUserId={session.userId}
      canCreateQuote={canCreateQuote}
      canAccessChecklists={canAccessChecklists}
      hoursSlot={
        <Suspense fallback={<WorkOrderHoursSectionSkeleton />}>
          <WorkOrderHoursSlot
            workOrderId={workOrder.id}
            assignedTo={workOrder.assigned_to}
            currentUserId={session.userId}
            members={members}
            canLogTimeForOthers={canLogTimeForOthers}
            canUpdateTimeEntriesAny={canUpdateTimeEntriesAny}
            canUpdateTimeEntriesOwn={canUpdateTimeEntriesOwn}
            canDelete={canDelete}
            canSeeCosts={canSeeCosts}
          />
        </Suspense>
      }
      materialSlot={
        <Suspense fallback={<WorkOrderMaterialSectionSkeleton />}>
          <WorkOrderMaterialSlot
            workOrderId={workOrder.id}
            canCreateWorkOrderArticles={canCreateWorkOrderArticles}
            canUpdateWorkOrderArticlesAny={canUpdateWorkOrderArticlesAny}
            canUpdateWorkOrderArticlesOwn={canUpdateWorkOrderArticlesOwn}
            canDelete={canDelete}
            currentUserId={session.userId}
            reportToInvoice={!canSeeCosts}
          />
        </Suspense>
      }
      checklistSlot={
        canAccessChecklists ? (
          <Suspense fallback={<WorkOrderChecklistSectionSkeleton />}>
            <WorkOrderChecklistSlot
              workOrderId={workOrder.id}
              currentUserId={session.userId}
              canAttachChecklist={canAttachChecklist}
              canDetachChecklist={canDetachChecklist}
              canUpdateChecklistAny={canUpdateChecklistAny}
              canUpdateChecklistOwn={canUpdateChecklistOwn}
            />
          </Suspense>
        ) : undefined
      }
    />
  );
}
