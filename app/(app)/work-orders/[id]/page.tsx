import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, DetailLayout, Heading, Stack, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getWorkOrder } from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listTimeEntries } from "../time-entries-actions";
import { getWorkOrderChecklist } from "../checklist-actions";
import { listChecklistTemplates } from "@/lib/checklist-templates/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { WorkOrderDetailActions } from "./work-order-detail-actions";
import { TimeEntriesPanel } from "./time-entries-panel";
import { ChecklistPanel } from "./checklist-panel";
import { WorkOrderFields } from "../components/work-order-fields";

export const metadata = { title: "Work order details" };

interface WorkOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Work order detail page — same visual weight as the Client/Asset detail
 * pages (docs/ARCHITECTURE.md "Relational detail pages"). No `Tabs` here:
 * unlike Client (Sites/Assets/Contacts) or a future Contract, neither of a
 * work order's child sub-entities (Time Entries, issue #15; Checklist, issue
 * #14) needs its own tab — each is a single always-visible Card section
 * (`TimeEntriesPanel`, `ChecklistPanel`) that reads better than a two-tab
 * `Tabs`, same reasoning `ContractAssetsPanel` documents for Contracts'
 * Linked Assets.
 *
 * *** Issue #89 ("New/Edit work order screens aligned") *** folded the
 * standalone `/work-orders/[id]/edit` page into this one — there is no
 * separate edit route left at all. The work order's own fields (Job /
 * Assignment & Schedule / Status & Priority, including its
 * Client/Site/Asset/Contract parents, previously a read-only "Site, asset &
 * contract" `DetailRow` `Card` here) are now `WorkOrderFields` itself,
 * rendered inline via `@yourorg/ui`'s `DetailLayout` — its fixed 340px rail
 * (this page's narrower column) holds those fields, its flexible main
 * column (the wider remaining space) holds Time Entries + Checklist, which
 * need the width for their own tables far more than the fields do. This is
 * also why the split runs "fields | content" rather than
 * `ClientDetail`'s "content | fields" — `DetailLayout`'s rail/main slots are
 * generic, and a Table-heavy section belongs in the flexible one regardless
 * of which side of the page it lands on.
 *
 * `WorkOrderFields`' own `readOnly` prop is exactly `!canEdit` below — a
 * `finance`/`administratie` viewer (plain `read`) still lands on this same
 * page, just with every field rendered as plain text instead of a form
 * (never a 404, never a disabled-but-technically-interactive input RLS would
 * just reject). Keyed by `workOrder.updated_at` so a successful inline save
 * (which does not navigate anywhere — see that component's own doc comment)
 * remounts it with the freshly saved values instead of leaving stale
 * uncontrolled-field state behind.
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

  const [
    clientResult,
    assetResult,
    membersResult,
    timeEntriesResult,
    timeEntryTypesResult,
    checklistResult,
    checklistTemplatesResult,
    clientsResult,
    statusesResult,
    prioritiesResult,
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
    // Client/Site/Asset/Contract pickers and the Status/Priority pickers
    // (`WorkOrderFields`, editable branch only) — skipped for a read-only
    // viewer, same "don't fetch what can't render" reasoning as
    // `checklistTemplatesResult` above.
    canEdit ? listClients({ limit: 200 }) : Promise.resolve(null),
    canEdit ? listReferenceItems("work_order_status") : Promise.resolve(null),
    canEdit ? listReferenceItems("work_order_priority") : Promise.resolve(null),
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
  const clients = clientsResult?.data?.clients ?? [];
  const statuses = statusesResult?.data?.items ?? [];
  const priorities = prioritiesResult?.data?.items ?? [];

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
          <WorkOrderDetailActions workOrder={workOrder} canDelete={canDelete} />
        </Toolbar.Section>
      </Toolbar>

      <DetailLayout
        rail={
          <WorkOrderFields
            key={workOrder.updated_at}
            mode="edit"
            workOrder={workOrder}
            readOnly={!canEdit}
            client={client}
            site={site}
            asset={asset}
            assignedMember={assignedMember}
            clients={clients}
            statuses={statuses}
            priorities={priorities}
            members={members}
            dense
          />
        }
      >
        <Stack gap="lg">
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
      </DetailLayout>
    </Stack>
  );
}
