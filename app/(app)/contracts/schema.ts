import { z } from "zod";

/**
 * Zod schemas for the Contracts module (issue #33 backend half, second
 * stage). Deliberately NOT a `"use server"` file — same reasoning as
 * `app/(app)/work-orders/schema.ts`/`app/(app)/clients/schema.ts`:
 * `app/(app)/contracts/actions.ts` imports these; a Server Action file may
 * only export async functions.
 *
 * Field names are camelCase; `actions.ts` maps the validated output to the
 * DB's snake_case columns.
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

/** `YYYY-MM-DD` date-only string, same shape as `assets.installedAt`/
 * `warrantyUntil` in `app/(app)/assets/schema.ts` — `contracts.start_date`/
 * `end_date` are both plain `date` columns, not `timestamptz`. */
const requiredIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format.");

const optionalIsoDateSchema = z.preprocess(emptyToUndefined, requiredIsoDateSchema.optional());

/**
 * Optional money amount with at most 2 decimal places, matching
 * `contracts.value numeric(12,2)`. `z.coerce.number()` mirrors the existing
 * numeric-field precedent (`siteCreateSchema.latitude`/`longitude` in
 * `app/(app)/clients/schema.ts`) — accepts a form's string or number input
 * alike. The 2-decimal-place check compares `value` against itself rounded
 * to the nearest cent (within a small epsilon) rather than using
 * `.multipleOf(0.01)`, which is itself prone to floating-point
 * representation artifacts for this exact use case (e.g.
 * `0.01 * 3 = 0.030000000000000002`).
 */
const optionalMoneySchema = z.preprocess(
  emptyToUndefined,
  z
    .coerce.number({ invalid_type_error: "Value must be a number." })
    .finite("Value must be a finite number.")
    .refine((value) => Math.abs(value - Math.round(value * 100) / 100) < 1e-9, {
      message: "Value must have at most 2 decimal places.",
    })
    .optional(),
);

export const contractCreateSchema = z.object({
  clientId: z.string().uuid("Invalid client id."),
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** FK into this org's `contract_type` reference list. Optional on create —
   * the `derive_contract_organization_id` DB trigger fills in the org's
   * default `contract_type` item ("Maintenance") when omitted, same UX as
   * `work_orders.statusId`/`assets.statusId`. */
  typeId: optionalUuid("Invalid contract type."),
  /** FK into this org's `sla_tier` reference list
   * (`reference_list_items.id`). Optional/nullable: not every contract needs
   * an SLA tier. `sla_tier` is a *dependent* list (`parent_list_key =
   * 'contract_type'`): whatever is selected here must be a tier of this
   * contract's own `typeId` (or its DB-filled default, if `typeId` was
   * omitted). Shape (uuid, belongs to the `sla_tier` list) plus the
   * cross-field "must be a tier of typeId" check are both left to the
   * `validate_contract_reference_items` DB trigger — same trust boundary
   * `work_orders.siteId`/`assetId` use, NOT the extra app-layer shape
   * pre-check `assets.subtypeId` gets (see `actions.ts`'s module comment for
   * why this module doesn't duplicate that pre-check). */
  slaTierId: optionalUuid("Invalid SLA tier."),
  /** FK into this org's `billing_terms` reference list. Nullable, standalone
   * (not a dependent list). Validated by `validate_contract_reference_items`. */
  billingTermsId: optionalUuid("Invalid billing terms."),
  startDate: requiredIsoDateSchema,
  /** Nullable — open-ended contracts are real. When set, must be >=
   * `startDate` (DB check constraint `contracts_end_date_after_start_date`;
   * not re-validated here, surfaces as a clean `mapDbError` `23514` message
   * if violated). */
  endDate: optionalIsoDateSchema,
  autoRenew: z.preprocess(emptyToUndefined, z.boolean().optional()),
  value: optionalMoneySchema,
  notes: optionalText(5000),
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. `clientId` stays updatable (re-parenting a contract to a
 * different client of the *same* organization is a legitimate edit, same
 * reasoning as `siteUpdateSchema.clientId`/`workOrderUpdateSchema.clientId`);
 * cross-organization re-parenting is blocked at the DB trigger layer
 * regardless (`derive_contract_organization_id`). */
export const contractUpdateSchema = contractCreateSchema.partial();

export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
