import { z } from "zod";

/**
 * Zod schema for the per-tenant quote numbering settings (issue #228).
 * NOT a "use server" file (a Server Action file may only export async
 * functions). Mirrors the DB checks in `update_quote_numbering_settings`
 * (`20261117100000_quote_numbering.sql`); the DB additionally enforces
 * "never lower than the current number / the highest issued number".
 */
export const QUOTE_NUMBER_MAX = 2_000_000_000;

export const quoteNumberingSettingsSchema = z.object({
  prefix: z
    .string({ required_error: "Prefix is required." })
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z
        .string()
        .regex(/^[A-Z0-9._/-]{1,10}$/, "Prefix must be 1-10 characters: letters A-Z, digits 0-9 and - _ . / only."),
    ),
  nextNumber: z.coerce
    .number({ invalid_type_error: "Next number must be a number." })
    .int("Next number must be a whole number.")
    .min(1, "Next number must be at least 1.")
    .max(QUOTE_NUMBER_MAX, "Next number is too large."),
});

export type QuoteNumberingSettingsInput = z.infer<typeof quoteNumberingSettingsSchema>;
