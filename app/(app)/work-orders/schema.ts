import { z } from "zod";

/**
 * Zod schemas for the Work Orders module (issue #13 backend half, second
 * stage). Same "not a `use server` file" reasoning as
 * `app/(app)/clients/schema.ts`/`app/(app)/assets/schema.ts` —
 * `app/(app)/work-orders/actions.ts` imports these; a Server Action file may
 * only export async functions.
 *
 * Field names are camelCase; `actions.ts` maps the validated output to the
 * DB's snake_case columns.
 *
 * `contractId` (issue #33): `work_orders.contract_id` was deferred from
 * `supabase/migrations/20260823120000_work_orders_core.sql` (design note 5
 * there) and added by `supabase/migrations/20260823150000_contracts_core.sql`.
 * Shape-only validation here (uuid); the cross-field "must belong to the
 * same client_id as the work order" check is left entirely to the
 * `validate_work_order_relations` DB trigger — same trust boundary
 * `siteId`/`assetId` already use below.
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
}

function optionalUuid(message: string) {
  return z.preprocess(emptyToUndefined, z.string().uuid(message).optional());
}

/** Accepts both `Z`-suffixed and numeric-offset ISO 8601 datetimes (`{
 * offset: true }`) — `Date.prototype.toISOString()` (the common client-side
 * source for these fields) always produces the former, but the latter is
 * still valid ISO 8601 and there's no reason to reject it. The DB column is
 * `timestamptz`, which parses either directly. */
function optionalIsoDateTime(message: string) {
  return z.preprocess(
    emptyToUndefined,
    z.string().datetime({ offset: true, message }).optional(),
  );
}

export const workOrderCreateSchema = z.object({
  clientId: z.string().uuid("Invalid client id."),
  /** Nullable at the DB layer; when set, must belong to `clientId` (checked
   * server-side by the `validate_work_order_relations` DB trigger, not
   * re-validated here — see the module comment in `actions.ts` for why that
   * duplication isn't needed the way `assets.subtypeId`'s dependent-list
   * shape check is). */
  siteId: optionalUuid("Invalid site id."),
  /** Nullable; when set, must belong to `clientId` (and to `siteId`, if that
   * is also set) — same DB-trigger validation as `siteId` above. */
  assetId: optionalUuid("Invalid asset id."),
  /** Nullable; when set, must belong to `clientId` — same DB-trigger
   * validation as `siteId`/`assetId` above (see the module comment). */
  contractId: optionalUuid("Invalid contract."),
  /** Nullable; when set, must be a member of the work order's own
   * organization — validated by `validate_work_order_relations`. */
  assignedTo: optionalUuid("Invalid assignee."),
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  description: optionalText(5000),
  notes: optionalText(5000),
  /** FK into this org's `work_order_status` reference list. Optional on
   * create — the `derive_work_order_organization_id` DB trigger fills in the
   * org's default `work_order_status` item ("New") when omitted, same UX as
   * `assets.statusId`. */
  statusId: optionalUuid("Invalid status."),
  /** FK into this org's `work_order_priority` reference list. Nullable —
   * not every work order needs an explicit priority. */
  priorityId: optionalUuid("Invalid priority."),
  scheduledAt: optionalIsoDateTime("Expected a valid scheduled date/time."),
  completedAt: optionalIsoDateTime("Expected a valid completed date/time."),
});

export type WorkOrderCreateInput = z.infer<typeof workOrderCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. `clientId` stays updatable (re-parenting a work order to
 * a different client of the *same* organization is a legitimate edit, same
 * reasoning as `siteUpdateSchema.clientId`); cross-organization re-parenting
 * is blocked at the DB trigger layer regardless
 * (`derive_work_order_organization_id`). */
export const workOrderUpdateSchema = workOrderCreateSchema.partial();

export type WorkOrderUpdateInput = z.infer<typeof workOrderUpdateSchema>;

/**
 * Time Entries (issue #15) — clock-in/out time logged against a work order,
 * see `app/(app)/work-orders/time-entries-actions.ts` and
 * `supabase/migrations/20260823180000_time_entries_core.sql`. Folded into
 * this file rather than a separate `time-entries-schema.ts`, same convention
 * `contactCreateSchema`/`contactUpdateSchema` established in
 * `app/(app)/clients/schema.ts` for a sub-entity's schema living alongside
 * its parent's.
 *
 * There is deliberately no `workOrderId` field on either schema below — same
 * reasoning `contactCreateSchema`'s doc comment gives for omitting
 * `clientId`: `clockIn(workOrderId, input)` takes it as its own function
 * argument (validated with the same `uuidSchema` shape every other id
 * parameter in `actions.ts` uses), not a schema field, since a time entry is
 * always created in the context of one specific work order.
 *
 * `userId` is accepted by both schemas below purely as a *shape* check
 * (valid uuid or absent). Whether a given caller is actually allowed to set
 * it to someone other than themselves is an RBAC decision, not a Zod one —
 * see `time-entries-actions.ts`'s `clockIn` (app-layer: engineers are always
 * pinned to their own id, regardless of what they pass here) and
 * `updateTimeEntry`/RLS's `WITH CHECK` (DB-layer, for the same reason
 * `work_orders.assignedTo` relies on RLS rather than an app-layer check —
 * see this file's `workOrderCreateSchema.assignedTo` comment).
 */
export const timeEntryClockInSchema = z.object({
  /** Only usable by a caller with plain `create` (owner/planner) to clock
   * someone else in; an engineer's `create_own`-only clock-in ignores this
   * field entirely and is always pinned to their own id — see `clockIn`. */
  userId: optionalUuid("Invalid user id."),
  /** FK into this org's `time_entry_type` reference list. Optional — the
   * `derive_time_entry_organization_id` DB trigger fills in the
   * organization's default item ("Labor") when omitted, same UX as
   * `workOrderCreateSchema.statusId`. */
  entryTypeId: optionalUuid("Invalid time entry type."),
});

export type TimeEntryClockInInput = z.infer<typeof timeEntryClockInSchema>;

/** General edit (clock-out is `updateTimeEntry({ endedAt })` under the hood
 * in spirit, but `clockOut(id)` is its own action for the common case — see
 * `time-entries-actions.ts`). Every field optional; still validated the same
 * way when present. */
export const timeEntryUpdateSchema = z.object({
  userId: optionalUuid("Invalid user id."),
  entryTypeId: optionalUuid("Invalid time entry type."),
  startedAt: optionalIsoDateTime("Expected a valid start date/time."),
  endedAt: optionalIsoDateTime("Expected a valid end date/time."),
  notes: optionalText(5000),
});

export type TimeEntryUpdateInput = z.infer<typeof timeEntryUpdateSchema>;
