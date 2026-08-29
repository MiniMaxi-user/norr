import { notFound } from "next/navigation";
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
import { WorkOrderScreen } from "../components/work-order-screen";

export const metadata = { title: "Edit workorder" };

interface WorkOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Work order detail page — renders the same shared `WorkOrderScreen`
 * (`../components/work-order-screen.tsx`, `mode="edit"`) that
 * `/work-orders/new` renders with `mode="create"` — both routes are one
 * genuinely shared screen now, not two hand-maintained layouts. No `Tabs`
 * here: unlike Client (Sites/Assets/Contacts) or a future Contract, neither
 * of a work order's child sub-entities (Time Entries, issue #15; Checklist,
 * issue #14) needs its own tab — each is a single always-visible Card
 * section (`TimeEntriesPanel`, `ChecklistPanel`) rendered full width below
 * the fields, same reasoning `ContractAssetsPanel` documents for Contracts'
 * Linked Assets.
 *
 * *** Issue #89 ("New/Edit work order screens aligned") *** folded the
 * standalone `/work-orders/[id]/edit` page into this one — there is no
 * separate edit route left at all. The work order's own fields (Job /
 * Assignment & Schedule / Status & Priority, including its
 * Client/Site/Asset/Contract parents, previously a read-only "Site, asset &
 * contract" `DetailRow` `Card` here) are now `WorkOrderFields` itself.
 *
 * *** A later pass (see `work-order-screen.tsx`'s own doc comment) *** moved
 * this off the old fields-in-a-340px-rail/`DetailLayout` split into a plain
 * full-width `Stack`: `DetailHero` for the title/badges/actions, then
 * `WorkOrderFields` (no more `dense`), then Time Entries/Checklist — Job and
 * Assignment & Schedule read better near the top with the record's fields at
 * full width, Time Entries/Checklist following below.
 *
 * `WorkOrderFields`' own `readOnly` prop is exactly `!canEdit` below — a
 * `finance`/`administratie` viewer (plain `read`) still lands on this same
 * page, just with every field rendered as plain text instead of a form
 * (never a 404, never a disabled-but-technically-interactive input RLS would
 * just reject). `WorkOrderScreen` is keyed by `workOrder.updated_at` so a
 * successful inline save (which does not navigate anywhere — see that
 * component's own doc comment) remounts it with the freshly saved values
 * instead of leaving stale uncontrolled-field state behind.
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
  //
  // Plain `create` (owner/planner) only — the manual Travel/Work "Add" entry
  // rows let picking WHICH engineer the entry belongs to, which only a
  // caller who can actually log on someone else's behalf may exercise (see
  // `createTimeEntry`'s own on-behalf-of logic in `time-entries-actions.ts`).
  const canLogTimeForOthers = can(actor, "planning", "create");
  const canUpdateTimeEntriesAny = can(actor, "planning", "update");
  const canUpdateTimeEntriesOwn = can(actor, "planning", "update_own");

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
      assignedMember={assignedMember}
      clients={clients}
      statuses={statuses}
      priorities={priorities}
      members={members}
      canDelete={canDelete}
      currentUserId={session.userId}
      timeEntries={timeEntries}
      timeEntryTypes={timeEntryTypes}
      canLogTimeForOthers={canLogTimeForOthers}
      canUpdateTimeEntriesAny={canUpdateTimeEntriesAny}
      canUpdateTimeEntriesOwn={canUpdateTimeEntriesOwn}
      canAccessChecklists={canAccessChecklists}
      checklist={checklist}
      checklistItems={checklistItems}
      checklistTemplates={checklistTemplates}
      canAttachChecklist={canAttachChecklist}
      canDetachChecklist={canDetachChecklist}
      canUpdateChecklistAny={canUpdateChecklistAny}
      canUpdateChecklistOwn={canUpdateChecklistOwn}
    />
  );
}
