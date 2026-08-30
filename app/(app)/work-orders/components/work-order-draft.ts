import type { WorkOrderRecord } from "../actions";

/**
 * The work order's own editable fields, as one flat draft object — the
 * single source of truth `WorkOrderScreen` owns for the redesigned one-
 * screen create/edit flow (issue #102). Every section of the page (hero
 * title, Status & Priority popup, relation cards + their edit popup,
 * Assignment popup) reads from this and writes back through
 * `WorkOrderScreen`'s own `commitPatch`, instead of each owning a disjoint
 * slice of local form state the way the old per-`Card` form did.
 */
export interface WorkOrderDraft {
  title: string;
  description: string;
  notes: string;
  clientId: string;
  siteId: string;
  assetId: string;
  contractId: string;
  assignedTo: string;
  /** Real ISO 8601 datetime, or `""` when unset — same convention
   * `scheduledAt` already used in the pre-redesign form. */
  scheduledAt: string;
  statusId: string;
  priorityId: string;
}

export function draftFromWorkOrder(workOrder: WorkOrderRecord): WorkOrderDraft {
  return {
    title: workOrder.title,
    description: workOrder.description ?? "",
    notes: workOrder.notes ?? "",
    clientId: workOrder.client_id,
    siteId: workOrder.site_id ?? "",
    assetId: workOrder.asset_id ?? "",
    contractId: workOrder.contract_id ?? "",
    assignedTo: workOrder.assigned_to ?? "",
    scheduledAt: workOrder.scheduled_at ?? "",
    statusId: workOrder.status_id,
    priorityId: workOrder.priority_id ?? "",
  };
}

export function emptyDraft(options: {
  lockedClientId?: string;
  initialSiteId?: string;
  initialAssetId?: string;
}): WorkOrderDraft {
  return {
    title: "",
    description: "",
    notes: "",
    clientId: options.lockedClientId ?? "",
    siteId: options.initialSiteId ?? "",
    assetId: options.initialAssetId ?? "",
    contractId: "",
    assignedTo: "",
    scheduledAt: "",
    statusId: "",
    priorityId: "",
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createWorkOrder`/`updateWorkOrder` (`./actions.ts`) expect — empty-string
 * "unset" values become `undefined` (not sent) rather than an empty-string
 * that would fail the schema's `uuid()` shape check. */
export function draftToInput(patch: Partial<WorkOrderDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.notes !== undefined) input.notes = patch.notes;
  if (patch.clientId !== undefined) input.clientId = patch.clientId || undefined;
  if (patch.siteId !== undefined) input.siteId = patch.siteId || undefined;
  if (patch.assetId !== undefined) input.assetId = patch.assetId || undefined;
  if (patch.contractId !== undefined) input.contractId = patch.contractId || undefined;
  if (patch.assignedTo !== undefined) input.assignedTo = patch.assignedTo || undefined;
  if (patch.scheduledAt !== undefined) input.scheduledAt = patch.scheduledAt || undefined;
  if (patch.statusId !== undefined) input.statusId = patch.statusId || undefined;
  if (patch.priorityId !== undefined) input.priorityId = patch.priorityId || undefined;
  return input;
}
