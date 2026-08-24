import { z } from "zod";

/**
 * Zod schemas for the Quotes module (issue #16, second stage — pre-sale
 * proposal builder). Deliberately NOT a `"use server"` file — same reasoning
 * as `app/(app)/contracts/schema.ts`/`app/(app)/work-orders/schema.ts`:
 * `app/(app)/quotes/actions.ts` imports these; a Server Action file may only
 * export async functions.
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

/** `YYYY-MM-DD` date-only string — `quotes.valid_until` is a plain `date`
 * column, not `timestamptz`, same shape as `contracts.startDate`/`endDate`
 * in `app/(app)/contracts/schema.ts`. */
const requiredIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format.");

const optionalIsoDateSchema = z.preprocess(emptyToUndefined, requiredIsoDateSchema.optional());

export const quoteCreateSchema = z.object({
  clientId: z.string().uuid("Invalid client id."),
  /** Nullable at the DB layer (`quotes.site_id`) — a quote may or may not be
   * tied to one specific location. When set, must belong to `clientId`;
   * that cross-field check is left entirely to the `validate_quote_relations`
   * DB trigger (not re-validated here), same trust boundary
   * `work_orders.siteId`/`contracts`' reference-list FKs use. */
  siteId: optionalUuid("Invalid site."),
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** FK into this org's `quote_status` reference list. Optional on create —
   * the `derive_quote_organization_id` DB trigger fills in the org's default
   * `quote_status` item ("Draft") when omitted, same UX as
   * `contracts.typeId`/`work_orders.statusId`. */
  statusId: optionalUuid("Invalid quote status."),
  validUntil: optionalIsoDateSchema,
  notes: optionalText(5000),
});

export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. `clientId` stays updatable (re-parenting a quote to a
 * different client of the *same* organization is a legitimate edit, same
 * reasoning as `contractUpdateSchema.clientId`); cross-organization
 * re-parenting is blocked at the DB trigger layer regardless
 * (`derive_quote_organization_id`). */
export const quoteUpdateSchema = quoteCreateSchema.partial();

export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>;

/** Required quantity, matching `quote_line_items.quantity numeric(10,2)` —
 * must be strictly greater than 0 (a zero/negative-quantity line item isn't a
 * meaningful pricing rule; the DB column itself has no check constraint for
 * this, so it's enforced here). `z.coerce.number()` mirrors
 * `contracts.value`'s existing numeric-field precedent — accepts a form's
 * string or number input alike. */
const quantitySchema = z.coerce
  .number({ invalid_type_error: "Quantity must be a number." })
  .finite("Quantity must be a finite number.")
  .gt(0, "Quantity must be greater than 0.");

/** Required unit price, matching `quote_line_items.unit_price numeric(12,2)`
 * — must be `>= 0` (a free/zero-cost line item is legitimate, e.g. a
 * complimentary inspection). The 2-decimal-place check compares the value
 * against itself rounded to the nearest cent (within a small epsilon) rather
 * than `.multipleOf(0.01)`, same reasoning `contracts.value`'s
 * `optionalMoneySchema` documents (floating-point representation artifacts). */
const unitPriceSchema = z.coerce
  .number({ invalid_type_error: "Unit price must be a number." })
  .finite("Unit price must be a finite number.")
  .min(0, "Unit price cannot be negative.")
  .refine((value) => Math.abs(value - Math.round(value * 100) / 100) < 1e-9, {
    message: "Unit price must have at most 2 decimal places.",
  });

export const quoteLineItemCreateSchema = z.object({
  description: z.string().trim().min(1, "Description is required.").max(2000, "Description is too long."),
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
  /** Nullable at the DB layer (`quote_line_items.asset_id`) — optional
   * context link, e.g. "this line item is for servicing this specific
   * asset". When set, must belong to the QUOTE's own `client_id`; that
   * cross-field check is left entirely to the
   * `validate_quote_line_item_relations` DB trigger (not re-validated here),
   * mirroring `contracts`' `linkContractAsset`/`contract_assets` trust
   * boundary. */
  assetId: optionalUuid("Invalid asset."),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int("Sort order must be a whole number.").optional()),
});

export type QuoteLineItemCreateInput = z.infer<typeof quoteLineItemCreateSchema>;

/** Every field optional for update (partial edit). `quoteId` is deliberately
 * NOT a field here at all — `quote_line_items.quote_id` is immutable after
 * creation (excluded from the DB's UPDATE column grant per the migration's
 * design note 5: delete + re-insert to move a line item to a different
 * quote), so there is nothing to validate for it on update. */
export const quoteLineItemUpdateSchema = quoteLineItemCreateSchema.partial();

export type QuoteLineItemUpdateInput = z.infer<typeof quoteLineItemUpdateSchema>;
