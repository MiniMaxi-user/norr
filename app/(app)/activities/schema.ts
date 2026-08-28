import { z } from "zod";

/**
 * Zod schemas for the Activities / "Meldingen" module (issue #59). Same
 * "not a `use server` file" reasoning as `app/(app)/work-orders/schema.ts` —
 * `app/(app)/activities/actions.ts` imports these; a Server Action file may
 * only export async functions.
 *
 * Field names are camelCase; `actions.ts` maps the validated output to the
 * DB's snake_case columns.
 *
 * What is (and isn't) validated here, vs. left to
 * `supabase/migrations/20260828090000_activities_core.sql`'s DB triggers:
 *  - Shape only for every FK (`z.string().uuid()`), same trust boundary
 *    `work_orders.siteId`/`assetId`/`assignedTo` use in
 *    `app/(app)/work-orders/schema.ts` — cross-field relationship checks
 *    (asset/contact belongs to this client, action holder is an org member)
 *    are the `validate_activity_relations` DB trigger's job, not this file's.
 *  - The ONE thing this schema *does* enforce beyond shape:
 *    `activityCreateSchema`'s `superRefine` requires at least one of
 *    `clientId`/`assetId` — the two entry points the acceptance criteria
 *    describe ("from a client" / "from an asset"). It deliberately does NOT
 *    attempt the type-dependent rules ("asset required for storing/
 *    onderhoud", "contact info required for bel_activiteit") — those depend
 *    on resolving `typeId` (an opaque uuid) to its stable `value` slug, which
 *    needs a DB round trip. That resolution + those two field-level checks
 *    live in `actions.ts`'s `createActivity` (see `resolveActivityTypeValue`
 *    there), run right after this schema parses successfully, before the
 *    insert — same "defense-in-depth pre-check for a clean field error,
 *    DB trigger is still the real backstop" pattern
 *    `app/(app)/assets/actions.ts`'s `validateAssetSubtype`/`validateAssetBrand`
 *    already establish.
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

const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.string().trim().email("Invalid email address.").max(320).optional(),
);

/**
 * Base shape, shared by create (below, with the "at least one of
 * clientId/assetId" refinement added) and update (a plain `.partial()` of
 * this object, no refinement — see `activityUpdateSchema`).
 */
const activityBaseSchema = z.object({
  /** Required unless `assetId` is provided instead (the "from an asset"
   * entry point) — `createActivity` derives the real `clientId` from the
   * asset's own `client_id` server-side in that case, never trusting a
   * client-supplied `clientId` that might not match (per this issue's own
   * instruction: an asset's client is always the source of truth, not
   * whatever the caller separately claims `clientId` to be). */
  clientId: optionalUuid("Invalid client id."),
  /** Optional — the "from a client" entry point omits this entirely. When
   * present, `createActivity` looks up its `client_id` and uses that as the
   * activity's `clientId`, ignoring any `clientId` also passed in the same
   * input. `validate_activity_relations` re-checks (redundantly, but
   * harmlessly) that this asset belongs to the resolved `clientId`. */
  assetId: optionalUuid("Invalid asset id."),
  /** FK into this org's `activity_type` reference list. Always required — no
   * seeded default, no auto-fill fallback (see the migration's design note
   * 2): the type picker always requires an explicit choice. */
  typeId: z.string().uuid("Invalid activity type."),
  /** FK into this org's `activity_status` reference list. Optional on
   * create — the `derive_activity_organization_id` DB trigger fills in the
   * org's default `activity_status` item ("Open") when omitted, same UX as
   * `work_orders.statusId`. */
  statusId: optionalUuid("Invalid status."),
  /** Optional link to an existing `contacts` row for this activity's client.
   * Selecting one is expected to copy that contact's name/phone into
   * `contactName`/`contactPhone` below (UI-layer convenience, per the
   * migration's design note 5) — this schema does not enforce that copy. */
  contactPersonId: optionalUuid("Invalid contact person."),
  /** Overridable contact name snapshot, independent of `contactPersonId` and
   * never written back onto a `contacts` row. Required (together with
   * `contactPhone`), when `contactPersonId` is absent, for a "Bel
   * activiteit" activity — see the module comment above for where that
   * conditional check actually runs. */
  contactName: optionalText(200),
  contactPhone: optionalText(50),
  /** Always optional, even for "Bel activiteit" (only name+phone are
   * required there per the acceptance criteria). */
  contactEmail: optionalEmail,
  description: z.string().trim().min(1, "Description is required.").max(5000, "Description is too long."),
  /** The user responsible for following up. Always required on create (the
   * actiehouder picker is always shown/required, even for an engineer whose
   * own id is the only legitimate value) — `createActivity` silently pins
   * this to the caller's own id when they only hold `create_own` (mirrors
   * `timeEntryClockInSchema`/`clockIn`'s `userId` override in
   * `app/(app)/work-orders/schema.ts` / `time-entries-actions.ts`), rather
   * than trusting whatever value an engineer's form happened to submit.
   * Remains editable after creation ("mag wel worden aangepast na
   * aanmaak") for anyone with `update`/`update_own`. */
  actionHolderId: z.string().uuid("Invalid action holder."),
});

/**
 * Create: same base shape, plus the "at least one of clientId/assetId"
 * cross-field requirement for the two entry points the acceptance criteria
 * describe.
 */
export const activityCreateSchema = activityBaseSchema.superRefine((data, ctx) => {
  if (!data.clientId && !data.assetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clientId"],
      message: "Select a client or an asset.",
    });
  }
});

export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. Deliberately NOT `activityCreateSchema.partial()` — that
 * would carry over the "at least one of clientId/assetId" refinement, which
 * makes no sense for a partial edit that may touch neither field. Built from
 * `activityBaseSchema` (the plain object, pre-refinement) instead. */
export const activityUpdateSchema = activityBaseSchema.partial();

export type ActivityUpdateInput = z.infer<typeof activityUpdateSchema>;
