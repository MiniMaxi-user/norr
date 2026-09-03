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

/** Like `optionalUuid`, but an empty string becomes `null` (a real,
 * distinguishable "clear this field" value) instead of `undefined` ("field
 * not provided, don't touch it"). Used for `quote_line_items.asset_id`/
 * `article_id`/`engineer_user_id`, which need exactly that distinction on
 * UPDATE — inline-editing a line item always resubmits its full current
 * state (see `quote-line-items-panel.tsx`'s `saveDraft`), so `""` there
 * unambiguously means the user cleared a previously-set picker, not that the
 * field was omitted. Safe on CREATE too: both row builders below already
 * write `?? null` for these three fields regardless of null vs undefined. */
function clearableUuid(message: string) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().uuid(message).nullable().optional(),
  );
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

/** Optional discount percentage, matching
 * `quote_line_items.discount_percent numeric(5,2) check (>= 0 and <= 100)`
 * (issue #95). Optional on create — when omitted, the DB column's own
 * `not null default 0` applies (same "let the DB default apply" treatment
 * `quoteCreateSchema.statusId` documents), same 2-decimal-place check as
 * `unitPriceSchema` for the same floating-point-representation reasoning. */
const discountPercentSchema = z.coerce
  .number({ invalid_type_error: "Discount must be a number." })
  .finite("Discount must be a finite number.")
  .min(0, "Discount cannot be negative.")
  .max(100, "Discount cannot exceed 100%.")
  .refine((value) => Math.abs(value - Math.round(value * 100) / 100) < 1e-9, {
    message: "Discount must have at most 2 decimal places.",
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
  assetId: clearableUuid("Invalid asset."),
  /** Nullable at the DB layer (`quote_line_items.article_id`, issue #94) —
   * the source article this line item was generated/picked from, for
   * reporting traceability. When set, must belong to the QUOTE's own
   * `organization_id`; left entirely to the
   * `validate_quote_line_item_relations` DB trigger, same trust boundary as
   * `assetId` above. */
  articleId: clearableUuid("Invalid article."),
  discountPercent: z.preprocess(emptyToUndefined, discountPercentSchema.optional()),
  /** Nullable at the DB layer (`quote_line_items.engineer_user_id`, issue
   * #95) — which engineer a travel/work-time-derived line item belongs to.
   * When set, must be a member of the quote's own organization; left
   * entirely to the `validate_quote_line_item_relations` DB trigger, same
   * trust boundary as `assetId`/`articleId` above. */
  engineerUserId: clearableUuid("Invalid engineer."),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int("Sort order must be a whole number.").optional()),
  /** Nullable at the DB layer (`quote_line_items.article_number text`,
   * migration `20260903130000_quote_line_items_article_number.sql`) — a
   * snapshot of the source article's own `article_number` at the moment it
   * was picked, independent of `description` (no longer concatenated into it,
   * see `../actions.ts`'s line-item row builders). Free text, no format
   * constraint — mirrors `articles.article_number`'s own plain-text DB
   * typing. `null`/omitted for a manually-typed line item with no linked
   * article. */
  articleNumber: optionalText(100),
});

export type QuoteLineItemCreateInput = z.infer<typeof quoteLineItemCreateSchema>;

/** Every field optional for update (partial edit). `quoteId` is deliberately
 * NOT a field here at all — `quote_line_items.quote_id` is immutable after
 * creation (excluded from the DB's UPDATE column grant per the migration's
 * design note 5: delete + re-insert to move a line item to a different
 * quote), so there is nothing to validate for it on update. */
export const quoteLineItemUpdateSchema = quoteLineItemCreateSchema.partial();

export type QuoteLineItemUpdateInput = z.infer<typeof quoteLineItemUpdateSchema>;
