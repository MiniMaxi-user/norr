import { z } from "zod";

/**
 * Zod schemas for the Clients module (clients + sites), issue #8.
 * Deliberately NOT a `"use server"` file — `app/(app)/clients/actions.ts`
 * imports these; a Server Action file may only export async functions, so
 * these plain schema objects live here instead.
 *
 * Field names are camelCase (the shape callers/forms use); `actions.ts`
 * maps the validated, camelCase output to the DB's snake_case columns.
 */

/** Turns an empty/whitespace-only string into `undefined` so an empty form
 * field is treated as "not provided" rather than failing e.g. email/uuid
 * validation on an empty string. */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
}

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  email: z.preprocess(emptyToUndefined, z.string().trim().email("Invalid email address.").max(320).optional()),
  phone: optionalText(50),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: optionalText(100),
  notes: optionalText(5000),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. */
export const clientUpdateSchema = clientCreateSchema.partial();

export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const siteCreateSchema = z.object({
  clientId: z.string().uuid("Invalid client id."),
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: optionalText(100),
  latitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-90).max(90).optional()),
  longitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-180).max(180).optional()),
  notes: optionalText(5000),
});

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;

/** `clientId` stays optional-but-allowed on update (moving a site to a
 * different client of the *same* organization is a legitimate edit; moving
 * it across organizations is blocked at the DB trigger layer regardless —
 * see `derive_site_organization_id` in the clients/sites/assets migration). */
export const siteUpdateSchema = siteCreateSchema.partial();

export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;

/**
 * Contacts (issue #26) — a client's contact persons, see
 * `app/(app)/clients/contacts-actions.ts` and
 * `supabase/migrations/20260823090000_contacts_dependent_reference_lists.sql`.
 * Unlike `siteCreateSchema`/`siteUpdateSchema`, there is no `clientId` field
 * here at all: `createContact(clientId, input)` takes it as a separate
 * function argument instead, and re-parenting a contact to a different
 * client is out of this pass's scope (contacts are always created/listed in
 * the context of one specific client tab, per docs/ARCHITECTURE.md
 * "Relational detail pages").
 */
export const contactCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  email: z.preprocess(emptyToUndefined, z.string().trim().email("Invalid email address.").max(320).optional()),
  phone: optionalText(50),
  /** FK into this org's `contact_role` reference list
   * (`reference_list_items.id`). Optional — not every contact needs a role.
   * Validated (list_key + organization match) by the `validate_contact_role_item`
   * DB trigger; `mapDbError`'s existing `23514`/`23503` mapping already
   * turns a bad value into a clean message, so no extra app-layer lookup is
   * duplicated here (unlike `assets.subtypeId`, `contact_role` is a flat,
   * non-dependent list — there's no cross-field rule to pre-check). */
  roleItemId: z.preprocess(emptyToUndefined, z.string().uuid("Invalid contact role.").optional()),
  /** At most one `true` per client — enforced by the DB
   * (`enforce_single_primary_contact` + `contacts_one_primary_per_client_idx`),
   * not re-validated here; see `createContact`/`updateContact` in
   * `contacts-actions.ts` for how a race on that constraint is surfaced. */
  isPrimary: z.boolean().optional(),
  notes: optionalText(5000),
});

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. */
export const contactUpdateSchema = contactCreateSchema.partial();

export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
