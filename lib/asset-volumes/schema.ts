import { z } from "zod";

/**
 * Zod schemas for asset volume readings (issue #221, `public.asset_volume_readings`).
 * Plain module (not `"use server"`), same split as every other module.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Readings in the future beyond this clock-skew allowance are rejected. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

/** `numeric(15,3)` max magnitude is 10^12 - 0.001. */
const MAX_VALUE = 999_999_999_999.999;

export const assetVolumeReadingValueSchema = z.coerce
  .number({ invalid_type_error: "Value must be a number." })
  .finite("Value must be a number.")
  .min(0, "Value cannot be negative.")
  .max(MAX_VALUE, "Value is too large.")
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Value has at most 3 decimals.");

export const assetVolumeReadingCreateSchema = z.object({
  assetId: uuidSchema,
  volumeItemId: uuidSchema,
  /** Accepts a number or a numeric string ("1200", "1200.5"). */
  value: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), assetVolumeReadingValueSchema),
  /**
   * ISO-8601 timestamp WITH offset (e.g. `new Date(localInput).toISOString()`).
   * Omitted = now. A zone-less string is rejected on purpose: the server has
   * no idea of the user's time zone.
   */
  readAt: z
    .string()
    .datetime({ offset: true, message: "Invalid date and time." })
    .refine((v) => new Date(v).getTime() <= Date.now() + FUTURE_TOLERANCE_MS, "Reading date cannot be in the future.")
    .optional(),
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(2000, "Notes are too long.").optional(),
  ),
  /** Set by the PWA route only; the web action never accepts it from input. */
  workOrderId: uuidSchema.optional(),
});

export type AssetVolumeReadingCreateInput = z.input<typeof assetVolumeReadingCreateSchema>;

export const assetVolumeReadingDeleteSchema = z.object({ id: uuidSchema });
