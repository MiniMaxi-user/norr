import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, Heading, Stack, Text, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getWorkOrder } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { WorkOrderDetailActions } from "./work-order-detail-actions";

export const metadata = { title: "Work order details" };

interface WorkOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text tone="muted">{label}</Text>
      <Text>{value}</Text>
    </Stack>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Work order detail page — same visual weight as the Client/Asset detail
 * pages (docs/ARCHITECTURE.md "Relational detail pages"). No `Tabs` of its
 * own here: unlike Client (Sites/Assets/Contacts) or a future Contract, a
 * work order has no child sub-entities of its own yet in this pass's scope
 * (photos/checklists/time tracking are explicitly out of scope per the
 * migration's own design note 6) — its *parents* (Client/Site/Asset) are
 * surfaced as linked `DetailRow`s instead, same treatment
 * `app/(app)/assets/[id]/page.tsx` gives its own Client/Site.
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

  const [clientResult, assetResult, membersResult] = await Promise.all([
    getClient(workOrder.client_id),
    workOrder.asset_id ? getAsset(workOrder.asset_id) : Promise.resolve(null),
    listOrgMembers(),
  ]);

  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === workOrder.site_id) ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const members = membersResult.data?.members ?? [];
  const assignedMember = members.find((member) => member.id === workOrder.assigned_to) ?? null;

  const canEdit = canAny(actor, "planning", ["update", "update_own"]);
  const canDelete = can(actor, "planning", "delete");

  return (
    <Stack gap="lg">
      <Breadcrumbs items={[{ label: "Work Orders", href: "/work-orders" }, { label: workOrder.title }]} />

      <Toolbar>
        <Toolbar.Section>
          <Stack gap="xs">
            <Heading level={1}>{workOrder.title}</Heading>
            <Stack gap="xs">
              <Badge color={workOrder.work_order_status?.color} variant="muted">
                {workOrder.work_order_status?.label ?? "—"}
              </Badge>
              {workOrder.work_order_priority && (
                <Badge color={workOrder.work_order_priority.color} variant="muted">
                  {workOrder.work_order_priority.label}
                </Badge>
              )}
            </Stack>
          </Stack>
        </Toolbar.Section>
        <Toolbar.Section align="end">
          <WorkOrderDetailActions workOrder={workOrder} canEdit={canEdit} canDelete={canDelete} />
        </Toolbar.Section>
      </Toolbar>

      <Card>
        <Stack gap="md">
          <DetailRow
            label="Client"
            value={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
          />
          <DetailRow
            label="Site"
            value={site ? `${site.name}${site.city ? ` — ${site.city}` : ""}` : "—"}
          />
          <DetailRow
            label="Asset"
            value={asset ? <Link href={`/assets/${asset.id}`}>{asset.name}</Link> : "—"}
          />
          <DetailRow label="Assigned to" value={memberDisplayName(assignedMember)} />
          <DetailRow label="Scheduled for" value={formatDateTime(workOrder.scheduled_at)} />
          <DetailRow label="Completed at" value={formatDateTime(workOrder.completed_at)} />
          <DetailRow label="Description" value={workOrder.description ?? "—"} />
          <DetailRow label="Notes" value={workOrder.notes ?? "—"} />
        </Stack>
      </Card>
    </Stack>
  );
}
