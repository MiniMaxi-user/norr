import { z } from "zod";

/**
 * Zod schemas for the Inventory / "Voorraad" module (issue #181, "[Story]
 * Locaties voorraad beheren"). See the comment at the top of
 * `app/(app)/clients/schema.ts` for why this is a plain module (not
 * `"use server"`) — `./actions.ts` imports from here.
 *
 * Schema reference: `supabase/migrations/20260916090000_warehouses_and_stock.sql`
 * (`warehouses` / `warehouse_stock`). Article search reuses
 * `app/(app)/articles/schema.ts`'s `articleSearchSchema` /
 * `app/(app)/articles/search-filter.ts`'s `buildArticleSearchFilter` directly
 * (imported by `./actions.ts`) rather than duplicating them here — that
 * search shape is explicitly exported for cross-module reuse (see that
 * file's own header comment), unlike this codebase's "duplicate small types
 * per module" convention for embed shapes.
 */

/** `warehouses.name` — editable display name, defaulted server-side (DB
 * trigger) to the engineer's own full name/email when omitted/blank on
 * insert, but this module never inserts a name (warehouses are
 * auto-created) — only `updateWarehouseName` in `./actions.ts` writes it,
 * always with a caller-supplied, non-blank value. Max length is a sane cap
 * (the column itself is unconstrained `text`), matching
 * `articleGroupCreateSchema.name`'s own 200-char cap. */
export const warehouseNameSchema = z.string().trim().min(1, "Name is required.").max(200, "Name is too long.");

export type WarehouseNameInput = z.infer<typeof warehouseNameSchema>;

/** `warehouse_stock.quantity` — `numeric(12,3)`, `>= 0`
 * (`warehouse_stock_quantity_non_negative`). Unlike
 * `articleComponentAddSchema`'s `quantitySchema` (`article_components.quantity`
 * is `> 0`), zero is a valid on-hand quantity here (e.g. just-added or
 * fully-depleted stock), so this only enforces non-negative, not positive. */
export const warehouseStockQuantitySchema = z.coerce
  .number({ invalid_type_error: "Quantity must be a number." })
  .finite("Quantity must be a finite number.")
  .min(0, "Quantity must be zero or more.")
  .refine((value) => Math.abs(value - Math.round(value * 1000) / 1000) < 1e-9, {
    message: "Quantity must have at most 3 decimal places.",
  });

export type WarehouseStockQuantityInput = z.infer<typeof warehouseStockQuantitySchema>;

/** `warehouse_stock.min_threshold` — `numeric(12,3)`, nullable,
 * `>= 0` when present (`warehouse_stock_min_threshold_non_negative`
 * explicitly allows `null`). `null` clears the threshold (no red/orange/
 * green status color applied), distinct from `undefined`/omission — this
 * schema always expects one of the two, never "not provided", since
 * `updateWarehouseStockThreshold` in `./actions.ts` is the ONLY thing that
 * ever writes this column and always receives an explicit value (a cleared
 * form field maps to `null` client-side, not an absent argument). */
export const warehouseStockMinThresholdSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([
    z.null(),
    z.coerce
      .number({ invalid_type_error: "Minimum threshold must be a number." })
      .finite("Minimum threshold must be a finite number.")
      .min(0, "Minimum threshold must be zero or more.")
      .refine((value) => Math.abs(value - Math.round(value * 1000) / 1000) < 1e-9, {
        message: "Minimum threshold must have at most 3 decimal places.",
      }),
  ]),
);

export type WarehouseStockMinThresholdInput = z.infer<typeof warehouseStockMinThresholdSchema>;
