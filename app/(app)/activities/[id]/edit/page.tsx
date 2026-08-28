import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getActivity } from "../../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { ActivityForm } from "../../components/activity-form";

export const metadata = { title: "Edit activity" };

interface EditActivityPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page activity edit form (docs/ARCHITECTURE.md "Popup vs. full page").
 * Gated on `canAny(actor, "activities", ["update", "update_own"])` — owner/
 * planner (any row) or engineer (their own assigned row only; RLS is the
 * real backstop for the latter, same as `updateActivity`'s own comment).
 * Unlike the create page, the client/asset pickers are never locked here —
 * `activityUpdateSchema` allows editing either after creation.
 */
export default async function EditActivityPage({ params }: EditActivityPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();
  if (!canAny(actor, "activities", ["update", "update_own"])) notFound();

  const [activityResult, clientsResult, typesResult, statusesResult, membersResult] = await Promise.all([
    getActivity(id),
    listClients({ limit: 200 }),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
    listOrgMembers(),
  ]);
  if (!activityResult.data) notFound();
  const activity = activityResult.data.activity;

  const clients = clientsResult.data?.clients ?? [];
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];
  const members = membersResult.data?.members ?? [];

  const clientResult = await getClient(activity.client_id);
  const client = clientResult.data?.client ?? null;

  const canAssignOthers = can(actor, "activities", "update");

  const breadcrumbItems = client
    ? [
        { label: "Clients", href: "/clients" },
        { label: client.name, href: `/clients/${client.id}` },
        { label: "Meldingen", href: "/activities" },
        { label: "Edit activity" },
      ]
    : [{ label: "Meldingen", href: "/activities" }, { label: "Edit activity" }];

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Edit activity</Heading>
      <ActivityForm
        mode="edit"
        activity={activity}
        clients={clients}
        activityTypes={activityTypes}
        activityStatuses={activityStatuses}
        members={members}
        currentUserId={session.userId}
        canAssignOthers={canAssignOthers}
        redirectHref="/activities"
      />
    </Stack>
  );
}
