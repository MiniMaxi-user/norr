import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { getActivity } from "@/app/(app)/activities/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { createWorkOrder } from "../actions";
import { WorkOrderScreen } from "../components/work-order-screen";

export const metadata = { title: "New Work Order" };

interface NewWorkOrderPageProps {
  searchParams: Promise<{
    clientId?: string;
    siteId?: string;
    assetId?: string;
    contractId?: string;
    activityId?: string;
  }>;
}

/**
 * Full-page work order create form (docs/ARCHITECTURE.md "Popup vs. full
 * page — pick by weight, not habit" — Planning/Work Orders is named there as
 * a top-level module entity, same tier as Clients/Assets).
 *
 * In-context pre-scoping: arriving with `?clientId=...` (a future client-
 * scoped "New work order" entry point) locks the client picker, mirroring
 * `app/(app)/assets/new/page.tsx`'s `lockedClientId` handling exactly — the
 * resolved `lockedClient` record itself is also threaded through as the
 * `client` prop (issue #100) so `WorkOrderHero`'s relation cards can show a
 * real Client summary card even though the (locked, hidden) picker's own
 * `clients` list is never fetched in this branch.
 * `?siteId=...`/`?assetId=...` pre-select (without locking) the site/asset.
 * `?activityId=...` (issue #87, the Activity quick-view's "Create work
 * order" action) is validated to exist here (same shape as `clientId`'s
 * `lockedClientResult` check below), threaded through as `WorkOrderScreen`'s
 * `sourceActivityId` prop (`draftToInput`'s pass-through field, submitted as
 * part of the draft on create — CREATE-only by design, an existing work
 * order's originating activity isn't meant to be reassigned), AND — issue
 * #102's "then everything known on the activity gets filled in" (issue #103
 * widened this) — used to pre-fill (never lock) the activity's own
 * `client_id`/`asset_id`/`description`/`activity_type`/`action_holder_id`
 * via `initialClientId`/`initialAssetId`/`initialDescription`/`initialTitle`/
 * `initialAssignedTo`. `assetId`/`siteId` query params still win over the
 * activity's own asset when both are somehow present. `ActivityRecord`
 * (`app/(app)/activities/actions.ts`) has no `site_id`/`priority_id`/
 * `scheduled_at` fields of its own at all — those genuinely have no source to
 * pre-fill from, unlike `action_holder_id` ("Behandelaar"), which maps
 * directly to `WorkOrderDraft.assignedTo` (both are `users.id`, same id-space
 * `OrgMemberRecord.id` already uses).
 *
 * *** Issue #106 (site carry-over + auto-save from an Activity) ***
 * `ActivityRecord` has no `site_id` of its own (see above) — when the
 * activity has an `asset_id`, the resolved `AssetRecord.site_id` (always
 * non-null) is used as the transitive source instead, fetched via the same
 * `getAsset` action `[id]/page.tsx` already uses to resolve a work order's
 * own asset. An explicit `?siteId=...` query param still wins over this
 * inferred value, same precedence `assetId` already had over the activity's
 * own asset.
 *
 * When arriving via `?activityId=...` and client/site/asset/title all
 * resolve (see `resolvedClientId`/`resolvedAssetId`/`resolvedSiteId` below),
 * the work order is created immediately server-side (the exact same
 * `createWorkOrder` action + RBAC gate `WorkOrderScreen`'s manual "Create
 * work order" button uses) and this route redirects straight to
 * `/work-orders/{id}` — skipping the manual review/save step, since every
 * required field the manual screen would otherwise need a click to persist
 * is already known. Anything short of that (no asset on the activity, so no
 * site to infer; or the create call itself fails) falls through to today's
 * manual create screen unchanged.
 *
 * Gated on `can(actor, "planning", "create")` — owner/planner only, matching
 * `createWorkOrder`'s own RBAC check (and the RLS INSERT policy) exactly, so
 * an engineer never sees this route resolve at all.
 *
 * Issue #89 ("New/Edit work order screens aligned") deleted the separate
 * `/work-orders/[id]/edit` route entirely — an existing work order's fields
 * are now inline-editable directly on its own detail page (`[id]/page.tsx`).
 * *** Issue #102 *** went further: this route now renders the EXACT SAME
 * layout (`WorkOrderScreen`, `../components/work-order-screen.tsx`) as the
 * detail page — hero, relation cards, Hours/Material/Checklist/Assignment
 * all visible from the first paint (each simply starts in its own "save the
 * work order first" empty/disabled state) — rather than a stripped-down
 * fields-only form that only grows those sections in after a redirect to
 * `/work-orders/[id]`. That redirect still happens (creation genuinely needs
 * a "no id yet" step `createWorkOrder` expresses), but the screen itself no
 * longer visibly changes shape when it does.
 */
export default async function NewWorkOrderPage({ searchParams }: NewWorkOrderPageProps) {
  const { clientId, siteId, assetId, contractId, activityId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();
  if (!can(actor, "planning", "create")) notFound();

  const [clientsResult, lockedClientResult, activityResult, statusesResult, prioritiesResult, membersResult] =
    await Promise.all([
      clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      clientId ? getClient(clientId) : Promise.resolve(null),
      activityId ? getActivity(activityId) : Promise.resolve(null),
      listReferenceItems("work_order_status"),
      listReferenceItems("work_order_priority"),
      listOrgMembers(),
    ]);

  if (clientId && !lockedClientResult?.data) notFound();
  if (activityId && !activityResult?.data) notFound();

  const clients = clientsResult?.data?.clients ?? [];
  const lockedClient = lockedClientResult?.data?.client ?? null;
  const activity = activityResult?.data?.activity;
  const sourceActivityId = activity?.id;
  const statuses = statusesResult.data?.items ?? [];
  const priorities = prioritiesResult.data?.items ?? [];
  const members = membersResult.data?.members ?? [];

  // Issue #106, Task 1 — an activity has no `site_id` of its own; when it has
  // an `asset_id`, fetch the full asset (same `getAsset` action
  // `[id]/page.tsx` already uses) to carry its `site_id` over transitively.
  // An explicit `?assetId=...`/`?siteId=...` query param still wins over the
  // activity's own asset/inferred site, same precedence `initialAssetId`
  // already had.
  const resolvedAssetId = assetId ?? activity?.asset_id ?? undefined;
  const assetResult = resolvedAssetId ? await getAsset(resolvedAssetId) : null;
  const resolvedAsset = assetResult?.data?.asset ?? null;
  const resolvedSiteId = siteId ?? resolvedAsset?.site_id ?? undefined;

  // Issue #106, Task 2 — arriving via `?activityId=...` with client/site/
  // asset/title all resolved skips the manual review/save step entirely: the
  // work order is created immediately (through the same `createWorkOrder`
  // action + RBAC gate the manual "Create work order" button uses) and this
  // route redirects straight to the real detail page. Anything short of a
  // full resolve (most commonly: the activity has no `asset_id`, so no site
  // can be inferred) falls through to today's manual create screen below.
  if (activity) {
    const resolvedClientId = lockedClient?.id ?? activity.client_id;
    const resolvedTitle = activity.activity_type?.label;
    if (resolvedClientId && resolvedAssetId && resolvedSiteId && resolvedTitle) {
      const createResult = await createWorkOrder({
        clientId: resolvedClientId,
        siteId: resolvedSiteId,
        assetId: resolvedAssetId,
        sourceActivityId: activity.id,
        title: resolvedTitle,
        description: activity.description || undefined,
        assignedTo: activity.action_holder_id || undefined,
      });
      if (createResult.data) {
        redirect(`/work-orders/${createResult.data.workOrder.id}`);
      }
      // Falls through to the manual create screen below on failure (e.g. a
      // DB-trigger relation check this route doesn't itself re-validate) —
      // no forced save with data the user hasn't seen yet.
    }
  }

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "New work order" },
      ]
    : [{ label: "Work Orders", href: "/work-orders" }, { label: "New work order" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/work-orders";

  return (
    <WorkOrderScreen
      mode="create"
      breadcrumbItems={breadcrumbItems}
      clients={clients}
      client={lockedClient}
      lockedClientId={lockedClient?.id}
      initialClientId={activity?.client_id}
      initialSiteId={resolvedSiteId}
      initialAssetId={resolvedAssetId}
      initialContractId={contractId}
      initialDescription={activity?.description}
      initialTitle={activity?.activity_type?.label}
      initialAssignedTo={activity?.action_holder_id}
      sourceActivityId={sourceActivityId}
      statuses={statuses}
      priorities={priorities}
      members={members}
      cancelHref={cancelHref}
    />
  );
}
