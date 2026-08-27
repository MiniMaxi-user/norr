import { z } from "zod";

/**
 * Zod schemas for `public.account_managers` (issue #58 — "Als gebruiker wil
 * ik een kanban bord hebben voor mijn klanten", the Account Manager picker
 * half). Plain module (not `"use server"`), mirroring the split every other
 * module's `schema.ts`/`actions.ts` pair uses (see `lib/asset-models/schema.ts`).
 *
 * Unlike `assetModelUpdateSchema` (deliberately a full-replace, not a
 * `.partial()`, because of the `subtypeItemId`-clearing ambiguity documented
 * there), `accountManagerUpdateSchema` below IS a plain `.partial()` of the
 * create schema — this table has no nullable/clearable field where "omitted"
 * and "explicitly cleared" would collapse to the same `undefined` and need
 * telling apart. `.partial()` also matches the more common convention this
 * codebase otherwise uses for its `*UpdateSchema`s (see
 * `clientUpdateSchema`/`contactUpdateSchema`/`siteUpdateSchema` in
 * `app/(app)/clients/schema.ts`) — `assetModelUpdateSchema` is the
 * documented outlier, not the default.
 */

const nameSchema = z.string().trim().min(1, "Name is required.").max(200, "Name is too long.");

export const accountManagerCreateSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
});

export type AccountManagerCreateInput = z.infer<typeof accountManagerCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. See the module doc comment above for why this is a
 * plain `.partial()`, unlike `assetModelUpdateSchema`. */
export const accountManagerUpdateSchema = accountManagerCreateSchema.partial();

export type AccountManagerUpdateInput = z.infer<typeof accountManagerUpdateSchema>;
