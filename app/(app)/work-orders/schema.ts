import { z } from "zod";

/**
 * Zod schemas for the Work Orders module (issue #13 backend half, second
 * stage). Same "not a `use server` file" reasoning as
 * `app/(app)/clients/schema.ts`/`app/(app)/assets/schema.ts` —
 * `app/(app)/work-orders/actions.ts` imports these; a Server Action file may
 * only export async functions.
 *
 * Field names are camelCase; `actions.ts` maps the validated output to the
 * DB's snake_case columns. No `contractId` field — see
 * `supabase/migrations/20260823120000_work_orders_core.sql` design note 5
 * and this feature's task scope: that column doesn't exist yet.
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
