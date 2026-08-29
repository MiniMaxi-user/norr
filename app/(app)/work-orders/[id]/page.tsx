import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, Heading, Stack, Text, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getWorkOrder } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { listTimeEntries } from "../time-entries-actions";
import { getWorkOrderChecklist } from "../checklist-actions";
import { listChecklistTemplates } from "@/lib/checklist-templates/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { WorkOrderDetailActions } from "./work-order-detail-actions";
import { TimeEntriesPanel } from "./time-entries-panel";
import { ChecklistPanel } from "./checklist-panel";
import { formatDateTime } from "@/lib/format/date";

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


/**
 * Work order detail page — same visual weight as the Client/Asset detail
 * pages (docs/ARCHITECTURE.md "Relational detail pages"). No `Tabs` here:
 * unlike Client (Sites/Assets/Contacts) or a future Contract, neither of a
 * work order's child sub-entities (Time Entries, issue #15; Checklist, issue
 * #14) needs its own tab — each is a single always-visible Card section
 * (`TimeEntriesPanel`, `ChecklistPanel`) that reads better than a two-tab
 * `Tabs`, same reasoning `ContractAssetsPanel` documents for Contracts'
 * Linked Assets. Its *parents* (Client/Site/Asset/Contract) are surfaced as
 * `DetailRow`s in their own "Site, asset & contract" `Card` (issue #87,
 * revisited for "op de werkorder worden duidelijk de site en asset en
 * contract details getoond") — Client/Asset/Contract each link out to their
 * own detail page; Site does not, since (unlike Client/Asset/Contract) it has
 * no standalone detail route to link to — its formatted address is already
 * the clearest available representation. Photo/e-signature capture on the
 * checklist remains out of scope per the checklists migration's own design
 * notes (a documented follow-up, not an oversight).
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

  const [
    clientResult,
    assetResult,
    membersResult,
    timeEntriesResult,
    timeEntryTypesResult,
    checklistResult,
    checklistTemplatesResult,
  ] = await Promise.all([
    getClient(workOrder.client_id),
    workOrder.asset_id ? getAsset(workOrder.asset_id) : Promise.resolve(null),
    listOrgMembers(),
    listTimeEntries(workOrder.id),
    listReferenceItems("time_entry_type"),
    canAccessChecklists ? getWorkOrderChecklist(workOrder.id) : Promise.resolve(null),
    // Only needed to populate the "attach a checklist" template picker, and
    // only owner/planner ever see that affordance — skip the round trip
    // entirely for every other role.
    canAttachChecklist ? listChecklistTemplates() : Promise.resolve(null),
  ]);

  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === workOrder.site_id) ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const members = membersResult.data?.members ?? [];
  const assignedMember = members.find((member) => member.id === workOrder.assigned_to) ?? null;
  const timeEntries = timeEntriesResult.data?.timeEntries ?? [];
  const timeEntryTypes = timeEntryTypesResult.data?.items ?? [];
  const checklist = checklistResult?.data?.checklist ?? null;
  const checklistItems = checklistResult?.data?.items ?? [];
  const checklistTemplates = checklistTemplatesResult?.data?.templates ?? [];

  const canEdit = canAny(actor, "planning", ["update", "update_own"]);
  const canDelete = can(actor, "planning", "delete");
  // Time Entries (issue #15) share the `planning` module's own actions —
  // see time-entries-panel.tsx's module comment for why `canDelete` above is
  // reused as-is (owner/planner CRUD on `planning` implies both Work Orders
  // and their Time Entries sub-resource).
  const canLogTime = canAny(actor, "planning", ["create", "create_own"]);
  // Plain `create` (owner/planner) only — the manual Travel/Work "Add" entry
  // dialogs let picking WHICH engineer the entry belongs to, which only a
  // caller who can actually log on someone else's behalf may exercise (see
  // `createTimeEntry`'s own on-behalf-of logic in `time-entries-actions.ts`).
  // An engineer (`create_own` only) still gets `canLogTime` for the
  // clock-in/out affordance below, just not these two buttons.
  const canLogTimeForOthers = can(actor, "planning", "create");
  const canUpdateTimeEntriesAny = can(actor, "planning", "update");
  const canUpdateTimeEntriesOwn = can(actor, "planning", "update_own");

  // Checklists (issue #14) are their OWN module (see comment above), not a
  // reuse of `planning`'s actions/permissions.
  const canDetachChecklist = canAccessChecklists && can(actor, "checklists", "delete");
  const canUpdateChecklistAny = canAccessChecklists && can(actor, "checklists", "update");
  const canUpdateChecklistOwn = canAccessChecklists && can(actor, "checklists", "update_own");

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
          <Heading level={4}>Site, asset & contract</Heading>
          <DetailRow
            label="Client"
            value={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
          />
          {/* Site has no detail page of its own to link to (unlike
              Client/Asset/Contract below) — a client's Sites live entirely
              on the client detail page's own Sites tab, with no standalone
              route. Shown as its formatted address, which is already the
              clearest available representation. */}
          <DetailRow label="Site" value={site ? formatSiteAddressShort(site) ?? "—" : "—"} />
          <DetailRow
            label="Asset"
            value={asset ? <Link href={`/assets/${asset.id}`}>{asset.name}</Link> : "—"}
          />
          <DetailRow
            label="Contract"
            value={
              workOrder.contract ? (
                <Link href={`/contracts/${workOrder.contract.id}`}>{workOrder.contract.name}</Link>
              ) : (
                "—"
              )
            }
          />
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={4}>Schedule & notes</Heading>
          <DetailRow label="Assigned to" value={memberDisplayName(assignedMember)} />
          <DetailRow label="Scheduled for" value={formatDateTime(workOrder.scheduled_at, { month: "long" })} />
          <DetailRow label="Completed at" value={formatDateTime(workOrder.completed_at, { month: "long" })} />
          <DetailRow label="Description" value={workOrder.description ?? "—"} />
          <DetailRow label="Notes" value={workOrder.notes ?? "—"} />
        </Stack>
      </Card>

      <TimeEntriesPanel
        workOrderId={workOrder.id}
        timeEntries={timeEntries}
        members={members}
        entryTypes={timeEntryTypes}
        assignedTo={workOrder.assigned_to}
        currentUserId={session.userId}
        canLogTime={canLogTime}
        canLogTimeForOthers={canLogTimeForOthers}
        canUpdateAny={canUpdateTimeEntriesAny}
        canUpdateOwn={canUpdateTimeEntriesOwn}
        canDelete={canDelete}
      />

      {canAccessChecklists && (
        <ChecklistPanel
          workOrderId={workOrder.id}
          checklist={checklist}
          items={checklistItems}
          templates={checklistTemplates}
          members={members}
          currentUserId={session.userId}
          canAttach={canAttachChecklist}
          canDetach={canDetachChecklist}
          canUpdateAny={canUpdateChecklistAny}
          canUpdateOwn={canUpdateChecklistOwn}
        />
      )}
    </Stack>
  );
}
