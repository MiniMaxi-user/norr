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

/** Same empty-string-to-undefined treatment as `optionalText`, for a
 * `<select>`-sourced uuid field (visit/delivery/invoice contact) whose
 * "nothing selected" option submits `""`, not simply absent — without this,
 * `z.string().uuid()` would reject that empty string outright instead of
 * treating it as "not provided". */
function optionalUuid() {
  return z.preprocess(emptyToUndefined, z.string().uuid("Invalid contact.").optional());
}

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** Dutch Chamber of Commerce (KvK) registration number — plain text, no
   * format validation at the DB or app layer (see migration
   * `20260825150000_clients_business_fields.sql`). */
  kvkNumber: optionalText(50),
  /** VAT / BTW number — same "plain text, no format validation" treatment
   * as `kvkNumber`. */
  vatNumber: optionalText(50),
  /** Bank account IBAN. 34 is the real maximum IBAN length worldwide
   * (Malta/Saint Lucia use the longest IBAN format, 34 characters). */
  iban: optionalText(34),
  notes: optionalText(5000),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. */
export const clientUpdateSchema = clientCreateSchema.partial();

export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

/** Friendly mirror of the DB's `sites_at_least_one_purpose` CHECK
 * (`is_visit_address or is_invoice_address or is_delivery_address`), issue
 * #41 redo ("Sites as client addresses",
 * `supabase/migrations/20260825090000_sites_addresses.sql`). Surfaced as a
 * field error on `isVisitAddress` (the first of the three) rather than a raw
 * `23514` constraint violation. Exported so `app/(app)/clients/actions.ts`
 * can reuse the exact same message for the equivalent check it has to do by
 * hand on `updateSite` (a partial update may omit all three flags, which
 * `.refine()` on a `.partial()` schema can't express — see `siteUpdateSchema`
 * below — so `updateSite` re-derives "at least one true" after merging with
 * the existing row and needs the same wording). */
export const SITE_PURPOSE_REQUIRED_MESSAGE =
  "Select at least one purpose: visit, invoice, or delivery address.";

/** Issue #52: each purpose that's checked needs its own contact person.
 * Same "friendly schema message, but the real enforcement is manual"
 * relationship to the DB as `SITE_PURPOSE_REQUIRED_MESSAGE` — see that
 * constant's own comment and `createSite`/`updateSite` in `actions.ts`. */
export function siteContactRequiredMessage(purpose: "visit" | "invoice" | "delivery"): string {
  return `Select a ${purpose} contact, or uncheck ${purpose} address.`;
}

/**
 * Un-refined base shape shared by `siteCreateSchema` (refined, below) and
 * `siteUpdateSchema` (`.partial()`, below) — a `.refine()`-wrapped schema
 * can't itself be `.partial()`'d in zod, so the refine and the partial each
 * have to be layered on top of this plain object instead of on one another
 * (same shape `contactCreateSchema`/`contactUpdateSchema` above use, minus
 * the cross-field refine those don't need).
 *
 * `addressLine1`/`postalCode`/`city` are required (non-empty) as of issue
 * #41 redo — these are now the load-bearing address fields for the whole
 * feature (they were `optionalText` before, when a site was more of an
 * afterthought hanging off an asset). `country` is deliberately NOT
 * required (issue #42) — not every org's clients are domestic-only, but
 * requiring it up front was friction for the common single-country case;
 * `sites.country` was already a nullable column (no DB change needed here).
 * `latitude`/`longitude` are deliberately
 * NOT here at all: they're no longer client-submittable — repurposed to a
 * server-computed geocoding cache written by `createSite`/`updateSite` via
 * `lib/geocoding/nominatim.ts`, never entered manually. See
 * `supabase/migrations/20260825090000_sites_addresses.sql`.
 */
export const siteBaseSchema = z.object({
  clientId: z.string().uuid("Invalid client id."),
  addressLine1: z.string().trim().min(1, "Address is required.").max(200, "Address is too long."),
  addressLine2: optionalText(200),
  postalCode: z.string().trim().min(1, "Postal code is required.").max(20, "Postal code is too long."),
  city: z.string().trim().min(1, "City is required.").max(100, "City is too long."),
  country: optionalText(100),
  /** Visit / invoice / delivery address — at least one must be true
   * per row (see `SITE_PURPOSE_REQUIRED_MESSAGE`). All three optional here
   * at the field level (a partial update may touch none of them); enforced
   * as "at least one" by `siteCreateSchema`'s `.refine()` below, and by hand
   * in `updateSite` after merging with the existing row. */
  isVisitAddress: z.boolean().optional(),
  isInvoiceAddress: z.boolean().optional(),
  isDeliveryAddress: z.boolean().optional(),
  /** The visit/invoice/delivery contact person (issue #52) — each required
   * only when its matching purpose flag above is true (see
   * `siteContactRequiredMessage`; enforced by hand in `createSite`/
   * `updateSite`, not by a `.refine()` alone, same reasoning as the purpose
   * flags themselves). Must be a contact belonging to this SAME site's
   * `clientId` — the DB's `validate_site_contact_persons` trigger
   * (`supabase/migrations/20260826150000_sites_contact_persons.sql`) is the
   * actual backstop for that, not this schema. */
  visitContactId: optionalUuid(),
  invoiceContactId: optionalUuid(),
  deliveryContactId: optionalUuid(),
  /** At most one `true` per client — enforced by the DB
   * (`enforce_single_primary_site` + `sites_one_primary_per_client_idx`),
   * not re-validated here, mirroring `contactCreateSchema.isPrimary` above. */
  isPrimary: z.boolean().optional(),
  /** A site's own contact number (issue: phone relocated from `clients` to
   * `sites` — a client can have multiple sites/locations, each potentially
   * with its own number, so phone belongs here, not on the client). See
   * migration `20260826130000_sites_phone.sql`. */
  phone: optionalText(50),
  notes: optionalText(5000),
});

/** `.refine()` requires at least one purpose flag `true` — mirrors the DB's
 * `sites_at_least_one_purpose` CHECK, giving a friendly field error instead
 * of a raw `23514`. Note: `createSite` still applies its own "first site for
 * this client" override (forcing all three flags + `isPrimary` to `true`
 * regardless of what was submitted) *before* this would otherwise reject an
 * unpurposed first-site submission — see `createSite` in `actions.ts`, which
 * parses against the un-refined base shape directly for that reason rather
 * than against this schema. */
export const siteCreateSchema = siteBaseSchema
  .refine((data) => Boolean(data.isVisitAddress || data.isInvoiceAddress || data.isDeliveryAddress), {
    message: SITE_PURPOSE_REQUIRED_MESSAGE,
    path: ["isVisitAddress"],
  })
  .refine((data) => !data.isVisitAddress || Boolean(data.visitContactId), {
    message: siteContactRequiredMessage("visit"),
    path: ["visitContactId"],
  })
  .refine((data) => !data.isInvoiceAddress || Boolean(data.invoiceContactId), {
    message: siteContactRequiredMessage("invoice"),
    path: ["invoiceContactId"],
  })
  .refine((data) => !data.isDeliveryAddress || Boolean(data.deliveryContactId), {
    message: siteContactRequiredMessage("delivery"),
    path: ["deliveryContactId"],
  });

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. Built from `siteBaseSchema` (not from the refined
 * `siteCreateSchema` — refine + partial doesn't compose in zod). `clientId`
 * stays optional-but-allowed on update (moving a site to a different client
 * of the *same* organization is a legitimate edit; moving it across
 * organizations is blocked at the DB trigger layer regardless — see
 * `derive_site_organization_id` in the clients/sites/assets migration).
 * The "at least one purpose flag true" invariant can't be fully checked here
 * in isolation (a partial update may omit all three, meaning "leave
 * as-is") — `updateSite` re-checks it after merging with the existing row. */
export const siteUpdateSchema = siteBaseSchema.partial();

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
