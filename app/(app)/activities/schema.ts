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
  /** How this melding was resolved — unlike `description`, optional at every
   * point in the lifecycle (see `activities.solution`'s column comment in
   * `20260905090000_activity_solution_and_quote_created_event.sql`). Same
   * `optionalText` shape/max length as every other optional free-text field
   * in this schema. */
  solution: optionalText(5000),
  /** The user responsible for following up. Optional at this schema layer —
   * an unassigned activity is now a valid state (no longer defaulted to the
   * reporter), and it can be assigned later via a normal update. Still
   * effectively always set for an engineer specifically: `createActivity`
   * silently pins this to the caller's own id when they only hold
   * `create_own` (mirrors `timeEntryClockInSchema`/`clockIn`'s `userId`
   * override in `app/(app)/work-orders/schema.ts` / `time-entries-actions.ts`),
   * regardless of what they submit here — only a caller with unscoped
   * `create`/`update` (owner/planner) can actually leave it unset. Remains
   * editable after creation ("mag wel worden aangepast na aanmaak") for
   * anyone with `update`/`update_own`.
   *
   * Deliberately NOT `optionalUuid` (issue #133 bugfix) — that helper's
   * `emptyToUndefined` preprocessing collapses an explicit "clear this back
   * to unassigned" (`""` from the Action holder `<Select>`'s own "Unassigned"
   * option) into `undefined`, which `toActivityUpdateRow`'s `!== undefined`
   * guard then reads as "field not touched at all", silently no-opping the
   * clear on save. `activity-draft.ts`'s `draftToInput` converts that same
   * `""` into an explicit `null` instead (not `undefined`) specifically for
   * this field, so this schema needs `.nullable()` to accept it as a real,
   * intentional value distinct from "omitted" — `undefined` still means
   * "don't touch this field", `null` now means "unassign it". */
  actionHolderId: z.string().uuid("Invalid action holder.").nullable().optional(),
  /** FK into this org's `activity_subtypes` tree (issues #134/#138) — the
   * single deepest leaf node committed via the 3-level cascading Subtype
   * dropdown. Same `.nullable()` treatment as `actionHolderId` above, for the
   * same reason: a cascading picker needs a real "clear this back to unset"
   * affordance (e.g. picking a different top-level Activity Type should be
   * able to reset a subtype chosen under the old one), and plain `optionalUuid`
   * would collapse that clear into `undefined` — indistinguishable from
   * "field not touched" — the exact issue #133 bug this schema already had to
   * fix once for Action holder. `undefined` still means "don't touch this
   * field", `null` means "unassign it". Cross-org and root-type-match (this
   * subtype's root ancestor's `type_id` must equal `typeId` above) checks are
   * the `validate_activity_relations` DB trigger's job, same trust boundary
   * every other FK in this schema already uses — not re-validated here. */
  activitySubtypeId: z.string().uuid("Invalid activity subtype.").nullable().optional(),
  /** FK into this org's `solution_subtypes` tree (issues #134/#138) — same
   * `.nullable()` shape/trust-boundary as `activitySubtypeId` above, minus any
   * type-match concern (`solution_subtypes` is never linked to Type at any
   * level). */
  solutionSubtypeId: z.string().uuid("Invalid solution subtype.").nullable().optional(),
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

// ---------------------------------------------------------------------------
// Activity Subtypes (issues #134/#138) — self-referential, unlimited-depth
// tree, mirrors `articleGroupCreateSchema`/`articleGroupUpdateSchema` in
// `app/(app)/articles/schema.ts`, plus the root-xor-parent `typeId` wrinkle
// `activity_subtypes_root_xor_parent` enforces at the DB
// (`supabase/migrations/20260912090000_activity_and_solution_subtypes.sql`).
// ---------------------------------------------------------------------------

/**
 * Shared base shape for both create and update — same split as
 * `activityBaseSchema`/`activityCreateSchema`/`activityUpdateSchema` above:
 * the root-xor-parent refinement only makes sense on create (see
 * `activitySubtypeUpdateSchema`'s own comment below for why it's skipped on
 * update), so it can't be baked into a plain `z.object` that both schemas
 * `.partial()`/`.superRefine()` from — `.partial()` isn't available once a
 * schema has already been wrapped by `.superRefine()` (it returns a
 * `ZodEffects`, not a `ZodObject`).
 */
const activitySubtypeBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** Self-reference into `activity_subtypes`. Cross-org/self-reference/cycle
   * checks are all enforced by the DB's `validate_activity_subtype_parent`
   * trigger — not re-validated here, same trust boundary
   * `articleGroupCreateSchema.parentGroupId`'s comment documents. */
  parentSubtypeId: optionalUuid("Invalid parent subtype."),
  /** FK into this org's `activity_type` reference list. Legal ONLY on a root
   * node (`parentSubtypeId` absent) — see `activitySubtypeCreateSchema`'s
   * `superRefine` below for the client-side mirror of
   * `activity_subtypes_root_xor_parent`; `validate_activity_subtype_parent`
   * additionally confirms this resolves to an actual `activity_type` item in
   * this org, which is left entirely to the DB (same "shape only here" trust
   * boundary every other reference-list FK in this file uses). */
  typeId: optionalUuid("Invalid activity type."),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
});

/**
 * Create: base shape plus a client-side mirror of the DB's
 * `activity_subtypes_root_xor_parent` CHECK constraint — exactly one of
 * `parentSubtypeId`/`typeId` must be present, never both, never neither.
 * Same "duplicate the DB's real check for a clean field error, DB is still
 * the backstop" pattern this module's own top comment documents for
 * `activityCreateSchema`'s client/asset refinement.
 */
export const activitySubtypeCreateSchema = activitySubtypeBaseSchema.superRefine((data, ctx) => {
  const hasParent = data.parentSubtypeId !== undefined;
  const hasType = data.typeId !== undefined;
  if (hasParent === hasType) {
    const message = hasParent
      ? "A subtype cannot have both a parent subtype and an activity type — an activity type only belongs on a root-level subtype."
      : "Select a parent subtype, or an activity type if this is a root-level subtype.";
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentSubtypeId"], message });
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["typeId"], message });
  }
});

export type ActivitySubtypeCreateInput = z.infer<typeof activitySubtypeCreateSchema>;

/** Every field optional for update (partial edit); still validated the same
 * way when present. Deliberately NOT `activitySubtypeCreateSchema.partial()`
 * (not even available — see `activitySubtypeBaseSchema`'s comment) and,
 * unlike `activityUpdateSchema`, does NOT re-derive the root-xor-parent
 * refinement for partial edits either: the same reasoning
 * `activityUpdateSchema`'s own comment gives for skipping its refinement
 * applies here too (a partial edit rarely touches both fields at once, and
 * the DB's CHECK constraint + trigger are still the real backstop either
 * way) — built from `activitySubtypeBaseSchema` (the plain object,
 * pre-refinement) instead. */
export const activitySubtypeUpdateSchema = activitySubtypeBaseSchema.partial();

export type ActivitySubtypeUpdateInput = z.infer<typeof activitySubtypeUpdateSchema>;

// ---------------------------------------------------------------------------
// Solution Subtypes (issues #134/#138) — structurally identical to Activity
// Subtypes above minus the `typeId`/root-xor-parent concept entirely
// (`solution_subtypes` is never linked to Type at any level).
// ---------------------------------------------------------------------------

export const solutionSubtypeCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** Self-reference into `solution_subtypes`. Same trust boundary as
   * `activitySubtypeBaseSchema.parentSubtypeId` above — cross-org/
   * self-reference/cycle checks are the DB's `validate_solution_subtype_parent`
   * trigger's job. */
  parentSubtypeId: optionalUuid("Invalid parent subtype."),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
});

export type SolutionSubtypeCreateInput = z.infer<typeof solutionSubtypeCreateSchema>;

export const solutionSubtypeUpdateSchema = solutionSubtypeCreateSchema.partial();

export type SolutionSubtypeUpdateInput = z.infer<typeof solutionSubtypeUpdateSchema>;
