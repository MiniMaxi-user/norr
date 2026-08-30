import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getActivity } from "@/app/(app)/activities/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { WorkOrderScreen } from "../components/work-order-screen";

export const metadata = { title: "New Work Order" };

interface NewWorkOrderPageProps {
  searchParams: Promise<{ clientId?: string; siteId?: string; assetId?: string; activityId?: string }>;
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
  const { clientId, siteId, assetId, activityId } = await searchParams;

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
      initialSiteId={siteId}
      initialAssetId={assetId ?? activity?.asset_id ?? undefined}
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
