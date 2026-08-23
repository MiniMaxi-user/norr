import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getWorkOrder } from "../../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { WorkOrderForm } from "../../components/work-order-form";

export const metadata = { title: "Edit work order" };

interface EditWorkOrderPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page work order edit form (docs/ARCHITECTURE.md "Popup vs. full
 * page"). Gated on `canAny(actor, "planning", ["update", "update_own"])` —
 * owner/planner (any row) or engineer (their own assigned row only; RLS is
 * the real backstop for the latter, same as `updateWorkOrder`'s own
 * comment).
 */
export default async function EditWorkOrderPage({ params }: EditWorkOrderPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();
  if (!canAny(actor, "planning", ["update", "update_own"])) notFound();

  const [workOrderResult, clientsResult, statusesResult, prioritiesResult, membersResult] = await Promise.all([
    getWorkOrder(id),
    listClients({ limit: 200 }),
    listReferenceItems("work_order_status"),
    listReferenceItems("work_order_priority"),
    listOrgMembers(),
  ]);
  if (!workOrderResult.data) notFound();
  const workOrder = workOrderResult.data.workOrder;

  const clients = clientsResult.data?.clients ?? [];
  const statuses = statusesResult.data?.items ?? [];
  const priorities = prioritiesResult.data?.items ?? [];
  const members = membersResult.data?.members ?? [];

  const clientResult = await getClient(workOrder.client_id);
  const client = clientResult.data?.client ?? null;

  const breadcrumbItems = client
    ? [
        { label: "Clients", href: "/clients" },
        { label: client.name, href: `/clients/${client.id}` },
        { label: workOrder.title, href: `/work-orders/${workOrder.id}` },
        { label: "Edit" },
      ]
    : [
        { label: "Work Orders", href: "/work-orders" },
        { label: workOrder.title, href: `/work-orders/${workOrder.id}` },
        { label: "Edit" },
      ];

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Edit {workOrder.title}</Heading>
      <WorkOrderForm
        mode="edit"
        workOrder={workOrder}
        clients={clients}
        statuses={statuses}
        priorities={priorities}
        members={members}
        cancelHref={`/work-orders/${workOrder.id}`}
      />
    </Stack>
  );
}
