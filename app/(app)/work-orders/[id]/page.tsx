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
import { listTimeEntries } from "../time-entries-actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { WorkOrderDetailActions } from "./work-order-detail-actions";
import { TimeEntriesPanel } from "./time-entries-panel";

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
 * pages (docs/ARCHITECTURE.md "Relational detail pages"). No `Tabs` here:
 * unlike Client (Sites/Assets/Contacts) or a future Contract, a work order
 * has only one child sub-entity worth surfacing today (Time Entries, issue
 * #15) — a single always-visible `TimeEntriesPanel` section reads better
 * than a one-tab `Tabs`, same reasoning `ContractAssetsPanel` documents for
 * Contracts' Linked Assets. Its *parents* (Client/Site/Asset) are surfaced
 * as linked `DetailRow`s instead, same treatment `app/(app)/assets/[id]/page.tsx`
 * gives its own Client/Site. Photos/checklists remain out of scope per the
 * work_orders migration's design note 6.
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

  const [clientResult, assetResult, membersResult, timeEntriesResult, timeEntryTypesResult] = await Promise.all([
    getClient(workOrder.client_id),
    workOrder.asset_id ? getAsset(workOrder.asset_id) : Promise.resolve(null),
    listOrgMembers(),
    listTimeEntries(workOrder.id),
    listReferenceItems("time_entry_type"),
  ]);

  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === workOrder.site_id) ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const members = membersResult.data?.members ?? [];
  const assignedMember = members.find((member) => member.id === workOrder.assigned_to) ?? null;
  const timeEntries = timeEntriesResult.data?.timeEntries ?? [];
  const timeEntryTypes = timeEntryTypesResult.data?.items ?? [];

  const canEdit = canAny(actor, "planning", ["update", "update_own"]);
  const canDelete = can(actor, "planning", "delete");
  // Time Entries (issue #15) share the `planning` module's own actions —
  // see time-entries-panel.tsx's module comment for why `canDelete` above is
  // reused as-is (owner/planner CRUD on `planning` implies both Work Orders
  // and their Time Entries sub-resource).
  const canLogTime = canAny(actor, "planning", ["create", "create_own"]);
  const canUpdateTimeEntriesAny = can(actor, "planning", "update");
  const canUpdateTimeEntriesOwn = can(actor, "planning", "update_own");

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
          <DetailRow
            label="Contract"
            value={workOrder.contract ? <Link href={`/contracts/${workOrder.contract.id}`}>{workOrder.contract.name}</Link> : "—"}
          />
          <DetailRow label="Assigned to" value={memberDisplayName(assignedMember)} />
          <DetailRow label="Scheduled for" value={formatDateTime(workOrder.scheduled_at)} />
          <DetailRow label="Completed at" value={formatDateTime(workOrder.completed_at)} />
          <DetailRow label="Description" value={workOrder.description ?? "—"} />
          <DetailRow label="Notes" value={workOrder.notes ?? "—"} />
        </Stack>
      </Card>

      <TimeEntriesPanel
        workOrderId={workOrder.id}
        timeEntries={timeEntries}
        members={members}
        entryTypes={timeEntryTypes}
        currentUserId={session.userId}
        canLogTime={canLogTime}
        canUpdateAny={canUpdateTimeEntriesAny}
        canUpdateOwn={canUpdateTimeEntriesOwn}
        canDelete={canDelete}
      />
    </Stack>
  );
}
