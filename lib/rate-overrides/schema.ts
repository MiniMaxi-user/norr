import { z } from "zod";

/**
 * Shared Zod schema + row mapping for the "custom rate" override shape
 * introduced by issue #93 ("Reistijd en werktijd artikelen beheren" —
 * `supabase/migrations/20260830090000_engineer_client_rate_overrides.sql`).
 * IDENTICAL 5-column shape on both `public.memberships` (an "engineer" is a
 * membership row with `role = 'engineer'`) and `public.clients`:
 * `has_custom_rate` / `travel_article_id` / `work_article_id` /
 * `travel_sale_price` / `work_sale_price`. One shared schema+mapper here
 * mirrors that migration's own "one shared trigger function
 * (`validate_rate_override_articles`) for both tables" reuse, rather than
 * hand-writing the same has-custom-rate-requires-both-articles validation
 * twice — once in `lib/team/actions.ts` (engineer/membership) and once in
 * `app/(app)/clients/actions.ts` (client).
 *
 * Deliberately NOT a `"use server"` file — same reasoning as
 * `app/(app)/clients/schema.ts`'s header comment: a Server Action file may
 * only export async functions, so this plain schema/mapper module lives on
 * its own and is imported by the two actions files above.
 *
 * What this schema does NOT do: verify `travelArticleId`/`workArticleId`
 * actually exist and belong to the caller's own organization — that's a DB
 * round trip, left to each caller (a local `validateRateOverrideArticle`
 * defense-in-depth check, same pattern as `validateAssetModel` in
 * `app/(app)/assets/actions.ts`), backstopped either way by the DB's own
 * `validate_rate_override_articles` trigger.
 */
export const rateOverrideSchema = z
  .object({
    hasCustomRate: z.boolean(),
    travelArticleId: z.string().uuid("Invalid travel article.").nullable().optional(),
    workArticleId: z.string().uuid("Invalid work article.").nullable().optional(),
    travelSalePrice: z.coerce
      .number({ invalid_type_error: "Travel sale price must be a number." })
      .finite("Travel sale price must be a finite number.")
      .min(0, "Travel sale price must be zero or more.")
      .nullable()
      .optional(),
    workSalePrice: z.coerce
      .number({ invalid_type_error: "Work sale price must be a number." })
      .finite("Work sale price must be a finite number.")
      .min(0, "Work sale price must be zero or more.")
      .nullable()
      .optional(),
  })
  // Mirrors the DB's `..._custom_rate_requires_articles` CHECK
  // (`not has_custom_rate or (travel_article_id is not null and
  // work_article_id is not null)`) as a friendly per-field error instead of
  // a raw `23514`. Sale prices are NOT covered by that DB CHECK (see the
  // migration's design note 2 — an article's own `sale_price` can itself be
  // null), but the acceptance criteria for this story requires both prices
  // whenever the override is on, so that's enforced here at the app layer
  // only.
  .superRefine((data, ctx) => {
    if (!data.hasCustomRate) return;
    if (!data.travelArticleId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["travelArticleId"], message: "Select a travel article." });
    }
    if (!data.workArticleId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workArticleId"], message: "Select a work article." });
    }
    if (data.travelSalePrice === null || data.travelSalePrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["travelSalePrice"],
        message: "Enter a travel sale price.",
      });
    }
    if (data.workSalePrice === null || data.workSalePrice === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workSalePrice"], message: "Enter a work sale price." });
    }
  });

export type RateOverrideInput = z.infer<typeof rateOverrideSchema>;

export interface RateOverrideRow {
  has_custom_rate: boolean;
  travel_article_id: string | null;
  work_article_id: string | null;
  travel_sale_price: number | null;
  work_sale_price: number | null;
}

/**
 * Maps validated input to the snake_case row both `memberships` and
 * `clients` share. When `hasCustomRate` is `false`, the article ids/sale
 * prices are explicitly NULLED OUT here (not just left alone) — the
 * migration's own design note 2 flags this as a "should", not DB-enforced:
 * "the UI/api-backend-engineer should clear them on uncheck for tidy data,
 * but the DB does not force it". Clearing here means a previously-configured
 * override can never silently reappear stale if the checkbox is re-enabled
 * later without the user re-picking articles/prices — the acceptance
 * criteria already requires re-entering both articles + both prices whenever
 * the checkbox is (re-)turned on, so nothing is lost by clearing.
 */
export function toRateOverrideRow(input: RateOverrideInput): RateOverrideRow {
  if (!input.hasCustomRate) {
    return {
      has_custom_rate: false,
      travel_article_id: null,
      work_article_id: null,
      travel_sale_price: null,
      work_sale_price: null,
    };
  }
  return {
    has_custom_rate: true,
    travel_article_id: input.travelArticleId ?? null,
    work_article_id: input.workArticleId ?? null,
    travel_sale_price: input.travelSalePrice ?? null,
    work_sale_price: input.workSalePrice ?? null,
  };
}

export interface RateOverrideRecord {
  hasCustomRate: boolean;
  travelArticleId: string | null;
  workArticleId: string | null;
  travelSalePrice: number | null;
  workSalePrice: number | null;
}

/** Maps a raw DB row (snake_case, as selected straight off `memberships`/
 * `clients`) back to the camelCase shape callers hand to the frontend. */
export function fromRateOverrideRow(row: RateOverrideRow): RateOverrideRecord {
  return {
    hasCustomRate: row.has_custom_rate,
    travelArticleId: row.travel_article_id,
    workArticleId: row.work_article_id,
    travelSalePrice: row.travel_sale_price,
    workSalePrice: row.work_sale_price,
  };
}
