"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { activityCreateSchema, activityUpdateSchema } from "./schema";

/**
 * Server Actions for the Activities / "Meldingen" module (issue #59 backend
 * half). Same four-step preamble as every other module's actions (see the
 * block comment at the top of `app/(app)/clients/actions.ts` and
 * `app/(app)/work-orders/actions.ts`, this file's closest sibling): resolve
 * module context (`hasFeature` + RBAC actor) -> `can()`/`canAny()` -> Zod
 * validation -> query under the caller's own session (RLS is always the real
 * backstop). See `supabase/migrations/20260828090000_activities_core.sql` for
 * the full schema/trigger/RLS design this file consumes but does not modify.
 *
 * RBAC recap for `activities` (lib/rbac/permissions.ts, matches the
 * migration's RLS exactly): `owner`/`planner` have CRUD, all rows; `engineer`
 * has only `create_own`/`read_own`/`update_own`, where "own" =
 * `action_holder_id = auth.uid()` (no delete); `finance`/`administratie` have
 * plain `read`, all rows.
 *
 * *** RLS already does the engineer row-scoping for SELECT/UPDATE — no
 * app-layer filter needed for those. ***
 * `activities_select_scoped`/`activities_update_scoped` in the migration
 * already restrict an engineer's rows to `action_holder_id = auth.uid()`, and
 * `activities_update_scoped`'s `WITH CHECK` additionally stops an engineer
 * from reassigning an activity away from themselves (surfaces as a clean
 * `mapDbError` `42501` message here, not a silent no-op) — same lesson
 * `listWorkOrders`/`updateWorkOrder` document in `app/(app)/work-orders/actions.ts`
 * for the identical `assigned_to` shape. `listActivities`/`getActivity`/
 * `updateActivity` below do NOT add an app-layer `action_holder_id` filter on
 * top of that for the same reason.
 *
 * *** INSERT is the one spot that DOES need an app-layer decision, not just
 * RLS. ***
 * `activities_insert_scoped`'s `WITH CHECK` requires an engineer's new row to
 * already have `action_holder_id = auth.uid()` — rather than let a caller who
 * only holds `create_own` hit that as a raw `42501` if their form happened to
 * submit a different value, `createActivity` below silently pins
 * `action_holder_id` to the caller's own id whenever they lack the unscoped
 * `create` action, exactly mirroring `clockIn`'s `userId` override in
 * `app/(app)/work-orders/time-entries-actions.ts`.
 */

/** Resolved (embedded) shape of a `reference_list_items` row — mirrors
 * `ResolvedReferenceItem` in `app/(app)/work-orders/actions.ts`; kept as a
 * local copy rather than a shared import, same "each module owns its own"
 * pattern that file establishes. */
export interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

/** Same as `ResolvedReferenceItem`, plus the new generic `icon` column
 * (design note 3 of the migration) — only `activity_type` items carry one
 * today. */
export interface ResolvedActivityTypeItem extends ResolvedReferenceItem {
  icon: string | null;
}

/** Shallow embed shape for a linked `clients`/`assets`/`contacts` row — just
 * enough for a list/detail view's "which client/asset/contact is this"
 * label, same "shallow embed, not a full nested resolve" reasoning
 * `AssetRecord.asset_model`'s comment gives in `app/(app)/assets/actions.ts`. */
export interface ShallowNamedRecord {
  id: string;
  name: string;
}

/** Shallow embed shape for a linked `users` row (`action_holder_id`/
 * `reported_by`) — mirrors `OrgMemberRecord` in `lib/members/actions.ts`
 * minus the `role` field (not needed here, and would require a second join
 * through `memberships` this embed doesn't have). */
export interface ShallowUserRecord {
  id: string;
  email: string;
  full_name: string | null;
}

export interface ActivityRecord {
  id: string;
  organization_id: string;
  client_id: string;
  asset_id: string | null;
  type_id: string;
  status_id: string;
  contact_person_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  description: string;
  reported_at: string;
  reported_by: string | null;
  action_holder_id: string;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!activities_type_id_fkey(...)` — see
   * `ACTIVITY_SELECT` below. Postgres's default FK naming for an unnamed
   * column FK is `<table>_<column>_fkey` (same reasoning
   * `app/(app)/work-orders/actions.ts`'s `WORK_ORDER_SELECT` comment
   * documents). */
  activity_type: ResolvedActivityTypeItem | null;
  /** Embedded via `reference_list_items!activities_status_id_fkey(...)`. */
  activity_status: ResolvedReferenceItem | null;
  /** Embedded via `clients(id, name)` — the only FK from `activities` into
   * `clients`, so no `!fkey` disambiguator is needed. */
  client: ShallowNamedRecord | null;
  /** Embedded via `assets(id, name)`. `null` whenever `asset_id` is `null`
   * (not every activity is about one specific asset). */
  asset: ShallowNamedRecord | null;
  /** Embedded via `contacts(id, name)`. `null` whenever `contact_person_id`
   * is `null` — see `contact_name`/`contact_phone`/`contact_email` for the
   * (never-synced-back) override snapshot instead. */
  contact_person: ShallowNamedRecord | null;
  /** Embedded via `users!activities_action_holder_id_fkey(...)` — the `!fkey`
   * disambiguator is required here: `activities` has TWO FKs into `users`
   * (`action_holder_id` and `reported_by`), same two-FKs-into-one-table shape
   * `type_id`/`status_id` already have into `reference_list_items` above. */
  action_holder: ShallowUserRecord | null;
  /** Embedded via `users!activities_reported_by_fkey(...)`. `null` only in
   * the (should-not-happen-in-practice) case the reporting user's own row was
   * hard-deleted out from under this activity (`on delete set null`). */
  reporter: ShallowUserRecord | null;
}

/** Shared select shape for every query returning an `ActivityRecord`, so the
 * frontend gets every resolved label/icon/name the overview + detail views
 * need in one round trip — same reasoning as `WORK_ORDER_SELECT`/
 * `ASSET_SELECT` in their respective sibling files. */
const ACTIVITY_SELECT =
  "*, activity_type:reference_list_items!activities_type_id_fkey(value,label,color,icon), activity_status:reference_list_items!activities_status_id_fkey(value,label,color), client:clients(id,name), asset:assets(id,name), contact_person:contacts(id,name), action_holder:users!activities_action_holder_id_fkey(id,email,full_name), reporter:users!activities_reported_by_fkey(id,email,full_name)";

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Resolves `typeId`'s stable `value` slug (e.g. `"storing"`, `"bel_activiteit"`)
 * and confirms it actually belongs to this org's `activity_type` list — same
 * "defense-in-depth pre-check for a clean field error, DB trigger
 * (`validate_activity_reference_items`) is still the real backstop" pattern
 * `validateAssetSubtype`/`validateAssetBrand` establish in
 * `app/(app)/assets/actions.ts`. `createActivity` uses the resolved value to
 * enforce the two type-dependent requirements (asset for storing/onderhoud,
 * contact info for bel_activiteit) as clean field errors instead of letting
 * `validate_activity_relations` reject with a raw `23514`.
 */
async function resolveActivityTypeValue(
  supabase: SupabaseServerClient,
  typeId: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("value, reference_list:reference_lists(list_key)")
    .eq("id", typeId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };

  const listKey = (data?.reference_list as unknown as { list_key: string } | null)?.list_key;
  if (!data || listKey !== "activity_type") {
    return { ok: false, error: "Invalid activity type — it must be a value from the Activity Type list." };
  }

  return { ok: true, value: data.value as string };
}

/**
 * Resolves the `client_id` an activity should be inserted with, per the two
 * entry points the acceptance criteria describe:
 *  - "From an asset": `assetId` is set — its own `client_id` is looked up and
 *    used as the source of truth, regardless of whatever `clientId` was also
 *    passed (never trusted from the client — see the migration's design note
 *    4 and `schema.ts`'s `clientId` field comment).
 *  - "From a client": `assetId` is absent — the caller-supplied `clientId` is
 *    used directly (`activityCreateSchema`'s `superRefine` already guarantees
 *    at least one of the two is present by the time this runs).
 */
async function resolveActivityClientId(
  supabase: SupabaseServerClient,
  input: { clientId?: string; assetId?: string },
): Promise<{ ok: true; clientId: string } | { ok: false; error: string; fieldErrors: Record<string, string[]> }> {
  if (input.assetId) {
    const { data, error } = await supabase.from("assets").select("client_id").eq("id", input.assetId).maybeSingle();

    if (error) {
      const message = mapDbError(error);
      return { ok: false, error: message, fieldErrors: { assetId: [message] } };
    }
    if (!data) {
      const message = "Invalid asset — it does not exist, or you do not have access to it.";
      return { ok: false, error: message, fieldErrors: { assetId: [message] } };
    }

    return { ok: true, clientId: data.client_id as string };
  }

  if (input.clientId) {
    return { ok: true, clientId: input.clientId };
  }

  // Should not be reachable — activityCreateSchema's superRefine already
  // requires one of the two. Defensive fallback only.
  const message = "Select a client or an asset.";
  return { ok: false, error: message, fieldErrors: { clientId: [message] } };
}

function toActivityUpdateRow(input: ReturnType<typeof activityUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.assetId !== undefined) row.asset_id = input.assetId ?? null;
  if (input.typeId !== undefined) row.type_id = input.typeId;
  if (input.statusId !== undefined) row.status_id = input.statusId;
  if (input.contactPersonId !== undefined) row.contact_person_id = input.contactPersonId ?? null;
  if (input.contactName !== undefined) row.contact_name = input.contactName ?? null;
  if (input.contactPhone !== undefined) row.contact_phone = input.contactPhone ?? null;
  if (input.contactEmail !== undefined) row.contact_email = input.contactEmail ?? null;
  if (input.description !== undefined) row.description = input.description;
  if (input.actionHolderId !== undefined) row.action_holder_id = input.actionHolderId;
  return row;
}

export interface ListActivitiesOptions {
  clientId?: string;
  assetId?: string;
  statusId?: string;
  typeId?: string;
  actionHolderId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lists activities, org-scoped via RLS automatically (and, for an engineer
 * caller, already scoped to rows where they are the action holder — see the
 * module comment above). Supports filtering by `clientId`/`assetId`/
 * `statusId`/`typeId`/`actionHolderId` (all optional, combinable) for the
 * overview screen's filters (AC: "Activiteiten overzicht scherm is
 * beschikbaar (met filtering en add new)") and for the client detail page's
 * Activities tab (`listActivities({ clientId })`).
 *
 * Default order: most-recently-reported first — `reported_at` (not
 * `created_at`) is the meaningful "when did this melding come in" timestamp
 * per the acceptance criteria.
 */
export async function listActivities(
  options: ListActivitiesOptions = {},
): Promise<ActionResult<{ activities: ActivityRecord[]; count: number }>> {
  for (const [label, value] of [
    ["client id filter", options.clientId],
    ["asset id filter", options.assetId],
    ["status id filter", options.statusId],
    ["type id filter", options.typeId],
    ["action holder filter", options.actionHolderId],
  ] as const) {
    if (value !== undefined && !uuidSchema.safeParse(value).success) {
      return fail(`Invalid ${label}.`);
    }
  }

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["read", "read_own"])) {
    return fail("You do not have permission to view activities.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("activities").select(ACTIVITY_SELECT, { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.assetId) query = query.eq("asset_id", options.assetId);
  if (options.statusId) query = query.eq("status_id", options.statusId);
  if (options.typeId) query = query.eq("type_id", options.typeId);
  if (options.actionHolderId) query = query.eq("action_holder_id", options.actionHolderId);
  query = query.order("reported_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ activities: (data ?? []) as ActivityRecord[], count: count ?? 0 });
}

export async function getActivity(id: string): Promise<ActionResult<{ activity: ActivityRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["read", "read_own"])) {
    return fail("You do not have permission to view this activity.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT)
    .eq("id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Activity not found, or you do not have permission to view it.");
  return ok({ activity: data as ActivityRecord });
}

/**
 * Creates an activity. Gated on `canAny(actor, "activities", ["create",
 * "create_own"])` — owner/planner (unscoped `create`) or an engineer
 * (`create_own`, always pinned to their own id as `action_holder_id`, see
 * below). Both entry points from the acceptance criteria are supported via
 * `input.assetId`/`input.clientId` (see `resolveActivityClientId`).
 */
export async function createActivity(input: unknown): Promise<ActionResult<{ activity: ActivityRecord }>> {
  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["create", "create_own"])) {
    return fail("You do not have permission to create activities.");
  }

  const parsed = activityCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const clientIdResult = await resolveActivityClientId(supabase, parsed.data);
  if (!clientIdResult.ok) return fail(clientIdResult.error, clientIdResult.fieldErrors);

  const typeCheck = await resolveActivityTypeValue(supabase, parsed.data.typeId);
  if (!typeCheck.ok) return fail(typeCheck.error, { typeId: [typeCheck.error] });

  if ((typeCheck.value === "storing" || typeCheck.value === "onderhoud") && !parsed.data.assetId) {
    const message = "An asset is required for Storing or Onderhoud activities.";
    return fail(message, { assetId: [message] });
  }

  if (
    typeCheck.value === "bel_activiteit" &&
    !parsed.data.contactPersonId &&
    !(parsed.data.contactName && parsed.data.contactPhone)
  ) {
    const message = "A contact person, or both a name and phone number, is required for Bel activiteit.";
    return fail(message, { contactName: [message], contactPhone: [message] });
  }

  // A caller who only holds create_own (engineer) is always the action
  // holder on their own new activity, regardless of what actionHolderId they
  // submitted — mirrors clockIn's userId override in
  // app/(app)/work-orders/time-entries-actions.ts. A caller with plain
  // `create` (owner/planner) may set any org member as the action holder.
  const canAssignOthers = can(ctx.context.actor, "activities", "create");
  const actionHolderId = canAssignOthers ? parsed.data.actionHolderId : ctx.context.session.userId;

  const row: Record<string, unknown> = {
    client_id: clientIdResult.clientId,
    asset_id: parsed.data.assetId ?? null,
    type_id: parsed.data.typeId,
    contact_person_id: parsed.data.contactPersonId ?? null,
    contact_name: parsed.data.contactName ?? null,
    contact_phone: parsed.data.contactPhone ?? null,
    contact_email: parsed.data.contactEmail ?? null,
    description: parsed.data.description,
    action_holder_id: actionHolderId,
  };
  // status_id is intentionally omitted (not even sent as null) when not
  // provided — the derive_activity_organization_id DB trigger fills in the
  // organization's default activity_status item ("Open") on insert. Same
  // reasoning as toWorkOrderInsertRow's status_id omission in
  // app/(app)/work-orders/actions.ts.
  if (parsed.data.statusId !== undefined) row.status_id = parsed.data.statusId;

  const { data, error } = await supabase.from("activities").insert(row).select(ACTIVITY_SELECT).single();

  if (error) return fail(mapDbError(error));
  return ok({ activity: data as ActivityRecord });
}

/**
 * Owner/planner: any row. Engineer: only rows where they are (and, after the
 * update, remain) the action holder — RLS enforces both sides independently
 * (see the module comment above); this does not pre-emptively block an
 * engineer's attempt to reassign away from themselves the way `createActivity`
 * pre-empts a bad `actionHolderId` on create, since here it's the *intended*
 * behavior to surface as a clean `42501` message, same as
 * `updateWorkOrder`/`updateTimeEntry`.
 *
 * No app-layer pre-validation of the type-dependent asset/contact
 * requirements on update (unlike `createActivity`) — left entirely to
 * `validate_activity_relations`, same "no app-layer pre-validation of
 * cross-field relationships on update" trust boundary
 * `updateWorkOrder`/`updateSite` already use for their own conditionally-
 * required fields.
 */
export async function updateActivity(
  id: string,
  input: unknown,
): Promise<ActionResult<{ activity: ActivityRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["update", "update_own"])) {
    return fail("You do not have permission to update activities.");
  }

  const parsed = activityUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toActivityUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activities")
    .update(row)
    .eq("id", idResult.data)
    .select(ACTIVITY_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Activity not found, or you do not have permission to update it.");
  return ok({ activity: data as ActivityRecord });
}

/** Owner/planner only (per the RBAC matrix + RLS DELETE policy, both agree —
 * engineer has no `delete` action for `activities` at all, same "no gap to
 * document" shape as `deleteWorkOrder`/`deleteTimeEntry`). */
export async function deleteActivity(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "activities", "delete")) {
    return fail("Only an owner or planner can delete activities.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Activity not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
