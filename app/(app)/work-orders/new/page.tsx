import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getActivity } from "@/app/(app)/activities/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { WorkOrderForm } from "../components/work-order-form";

export const metadata = { title: "New work order" };

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
 * `app/(app)/assets/new/page.tsx`'s `lockedClientId` handling exactly;
 * `?siteId=...`/`?assetId=...` pre-select (without locking) the site/asset.
 * `?activityId=...` (issue #87, the Activity quick-view's "Create work
 * order" action) is a hidden traceability field, not a picker — it's
 * validated to exist here (same shape as `clientId`'s `lockedClientResult`
 * check below) and threaded straight through as `WorkOrderForm`'s
 * `sourceActivityId` prop, which renders it as a plain hidden input
 * (`workOrderCreateSchema.sourceActivityId`). CREATE-only by design (an
 * existing work order's originating activity isn't meant to be reassigned) —
 * `/work-orders/[id]/edit` has no equivalent query param.
 *
 * Gated on `can(actor, "planning", "create")` — owner/planner only, matching
 * `createWorkOrder`'s own RBAC check (and the RLS INSERT policy) exactly, so
 * an engineer never sees this route resolve at all.
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
  const sourceActivityId = activityResult?.data?.activity.id;
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
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>New work order</Heading>
      <WorkOrderForm
        mode="create"
        clients={clients}
        lockedClientId={lockedClient?.id}
        initialSiteId={siteId}
        initialAssetId={assetId}
        sourceActivityId={sourceActivityId}
        statuses={statuses}
        priorities={priorities}
        members={members}
        cancelHref={cancelHref}
      />
    </Stack>
  );
}
