import { z } from "zod";

/**
 * Zod schemas for the Articles module (issue #92, "Artikel database"). See
 * the comment at the top of `app/(app)/clients/schema.ts` for why this is a
 * plain module (not `"use server"`) — `./actions.ts` / `./groups-actions.ts`
 * / `./components-actions.ts` import from here.
 *
 * Schema reference: `supabase/migrations/20260829100000_articles_core.sql`
 * (`articles` / `article_groups` / `article_components`).
 */

/** Turns an empty/whitespace-only string into `undefined` so an empty form
 * field (or cleared `<select>`) is treated as "not provided" rather than
 * failing e.g. uuid/number validation on an empty string — same helper as
 * `app/(app)/clients/schema.ts` / `app/(app)/assets/schema.ts`. */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
}

function optionalUuid(label: string) {
  return z.preprocess(emptyToUndefined, z.string().uuid(`Invalid ${label}.`).optional());
}

/**
 * Optional money amount with at most 2 decimal places, non-negative —
 * matches `articles.purchase_price`/`articles.sale_price`'s
 * `numeric(12,2)` column type and their
 * `articles_purchase_price_non_negative`/`articles_sale_price_non_negative`
 * check constraints. Copied from `optionalPotentialValueSchema` in
 * `app/(app)/clients/schema.ts` (same shape, parameterized by field label for
 * the two distinct fields here).
 */
function optionalMoneySchema(fieldLabel: string) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: `${fieldLabel} must be a number.` })
      .finite(`${fieldLabel} must be a finite number.`)
      .min(0, `${fieldLabel} must be zero or more.`)
      .refine((value) => Math.abs(value - Math.round(value * 100) / 100) < 1e-9, {
        message: `${fieldLabel} must have at most 2 decimal places.`,
      })
      .optional(),
  );
}

export const articleCreateSchema = z.object({
  articleNumber: z.string().trim().min(1, "Article number is required.").max(100, "Article number is too long."),
  description: z.string().trim().min(1, "Description is required.").max(2000, "Description is too long."),
  ean: optionalText(64),
  gtin: optionalText(64),
  mpn: optionalText(100),
  /** Free-text image URL/path — no upload handling here (out of scope for
   * this backend pass), same "no FK, no validation beyond shape" treatment
   * as `externalReference` in `app/(app)/assets/schema.ts`. */
  imageUrl: optionalText(2000),
  /** FK into this org's `article_unit` reference list. Optional on create —
   * the `derive_article_defaults` DB trigger fills in the organization's
   * default `article_unit` item when omitted (see the migration). Validated
   * server-side (list_key + organization match) by
   * `validate_article_reference_items`. */
  unitItemId: optionalUuid("unit"),
  /** FK into this org's `article_manufacturer` reference list. Nullable —
   * not every article has a known manufacturer. */
  manufacturerItemId: optionalUuid("manufacturer"),
  /** FK into `article_groups` (this org's Article Group tree). Nullable —
   * grouping is a tenant-configured convenience. */
  groupId: optionalUuid("group"),
  purchasePrice: optionalMoneySchema("Purchase price"),
  salePrice: optionalMoneySchema("Sale price"),
  /** FK into this org's `vat_rate` reference list. Optional on create — same
   * `derive_article_defaults` fill-in as `unitItemId` (defaults to 21%). */
  vatRateItemId: optionalUuid("VAT rate"),
  isComposite: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type ArticleCreateInput = z.infer<typeof articleCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. */
export const articleUpdateSchema = articleCreateSchema.partial();

export type ArticleUpdateInput = z.infer<typeof articleUpdateSchema>;

/** Search term for `listArticles({ search })` — text search across
 * `article_number`/`description`/`ean`/`gtin`/`mpn` (issue #92's own overview
 * filtering, reused as-is by issue #95's quote/line-item article picker). */
export const articleSearchSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1, "Search term is too short.").max(200, "Search term is too long.").optional(),
);

// ---------------------------------------------------------------------------
// Article Groups
// ---------------------------------------------------------------------------

export const articleGroupCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** Self-reference into `article_groups`. Cross-org/self-reference/cycle
   * checks are all enforced by the DB's `validate_article_group_parent`
   * trigger — not re-validated here, per the task's scope (`mapDbError`'s
   * existing `23514` case already turns a rejection into a clean message). */
  parentGroupId: optionalUuid("parent group"),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
});

export type ArticleGroupCreateInput = z.infer<typeof articleGroupCreateSchema>;

export const articleGroupUpdateSchema = articleGroupCreateSchema.partial();

export type ArticleGroupUpdateInput = z.infer<typeof articleGroupUpdateSchema>;

// ---------------------------------------------------------------------------
// Article Components (BOM)
// ---------------------------------------------------------------------------

/** `numeric(12,3)`, `> 0` at the DB (`article_components_quantity_positive`).
 * Mirrors `optionalMoneySchema`'s "at most N decimal places" check above,
 * parameterized to 3 decimals instead of 2. */
const quantitySchema = z.coerce
  .number({ invalid_type_error: "Quantity must be a number." })
  .finite("Quantity must be a finite number.")
  .positive("Quantity must be greater than zero.")
  .refine((value) => Math.abs(value - Math.round(value * 1000) / 1000) < 1e-9, {
    message: "Quantity must have at most 3 decimal places.",
  });

export const articleComponentAddSchema = z.object({
  componentArticleId: z.string().uuid("Invalid component article."),
  quantity: quantitySchema,
});

export type ArticleComponentAddInput = z.infer<typeof articleComponentAddSchema>;

/** Quantity is the only mutable field on an existing `article_components` row
 * — `parent_article_id`/`component_article_id` are insert-only (see the
 * migration's grant comments); to change either side the caller deletes and
 * re-adds via `addArticleComponent`. */
export const articleComponentUpdateSchema = z.object({
  quantity: quantitySchema,
});

export type ArticleComponentUpdateInput = z.infer<typeof articleComponentUpdateSchema>;
