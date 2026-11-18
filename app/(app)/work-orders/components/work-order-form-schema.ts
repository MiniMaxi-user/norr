import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createWorkOrder, updateWorkOrder } from "../actions";
import { draftToInput, type WorkOrderDraft } from "./work-order-draft";

/**
 * Edit-mode schema of the Work order page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`workOrderCreateSchema`) — the server stays the authority — with messages
 * that say what is wrong and how to fix it.
 */

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

type LabelKey = "clientId" | "siteId" | "assetId" | "contractId" | "assignedTo" | "statusId" | "priorityId" | "typeId";

export function buildWorkOrderSchema(options: {
  labelFor: (key: LabelKey, id: string) => string;
}): EditSchema<WorkOrderDraft> {
  const { labelFor } = options;
  const format = (key: LabelKey) => (value: string) => (value ? labelFor(key, value) : "");
  return {
    clientId: {
      label: "Client",
      required: true,
      format: format("clientId"),
      validate: (value) => (value ? null : "Choose a client"),
    },
    siteId: { label: "Site", format: format("siteId") },
    assetId: { label: "Asset", format: format("assetId") },
    contractId: { label: "Contract", format: format("contractId") },
    assignedTo: { label: "Assigned to", format: format("assignedTo") },
    scheduledAt: {
      label: "Scheduled for",
      validate: (value) =>
        !value || !Number.isNaN(new Date(value).getTime()) ? null : "Enter a valid date and time, for example 17-11-2026 14:30",
    },
    statusId: { label: "Status", format: format("statusId") },
    priorityId: { label: "Priority", format: format("priorityId") },
    typeId: { label: "Type", format: format("typeId") },
    durationMinutes: {
      label: "Duration (minutes)",
      validate: (value) => {
        if (!value.trim()) return null;
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? null : "Enter a whole number of minutes, for example 60";
      },
    },
    externalReference: {
      label: "External reference",
      validate: (value) => tooLong("External reference", value, 200),
    },
    description: { label: "Description", validate: (value) => tooLong("Description", value, 5000) },
    notes: { label: "Notes", validate: (value) => tooLong("Notes", value, 5000) },
    solution: { label: "Solution", validate: (value) => tooLong("Solution", value, 5000) },
  };
}

type DraftKey = keyof WorkOrderDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited work order through the existing `updateWorkOrder` action
 * (RBAC, checkout lock, zod validation and RLS unchanged) — only the changed
 * fields are sent. */
export async function saveWorkOrderEdits(
  workOrderId: string,
  draft: WorkOrderDraft,
  dirty: DirtyField<WorkOrderDraft>[],
): Promise<SaveResult<WorkOrderDraft>> {
  const patch: Partial<WorkOrderDraft> = {};
  for (const entry of dirty) (patch as Record<string, unknown>)[entry.key] = draft[entry.key];
  const input = draftToInput(patch);
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateWorkOrder(workOrderId, input);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates a work order (new mode) through `createWorkOrder`; resolves with
 * the new id so the page can open its read page. `sourceActivityId` is
 * create-only traceability (see `new/page.tsx`). */
export async function createWorkOrderFromDraft(
  draft: WorkOrderDraft,
  sourceActivityId?: string,
): Promise<{ result: SaveResult<WorkOrderDraft>; workOrderId?: string }> {
  const created = await createWorkOrder({ ...draftToInput(draft), sourceActivityId });
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, workOrderId: created.data.workOrder.id };
}
