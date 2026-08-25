"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { geocodeAddress } from "@/lib/geocoding/nominatim";
import {
  clientCreateSchema,
  clientUpdateSchema,
  siteBaseSchema,
  siteUpdateSchema,
  SITE_PURPOSE_REQUIRED_MESSAGE,
  type SiteCreateInput,
  type SiteUpdateInput,
} from "./schema";

/**
 * Server Actions for the Clients module (clients + their sites), issue #8
 * backend half. Every action:
 *  1. Resolves session + feature flag + RBAC actor via `requireModuleContext`
 *     (CLAUDE.md rules 2 & 3 — checked before any side effect).
 *  2. Checks `can()`/`canAny()` from `lib/rbac/permissions.ts` for the
 *     specific action (never an inline `if (role === ...)`).
 *  3. Validates input with the Zod schemas in `./schema.ts`.
 *  4. Runs the query under the caller's own session via
 *     `lib/supabase/server.ts` (never `admin.ts`) — RLS is always the
 *     backstop, `can()` is just there to fail cleanly *before* hitting the
 *     DB and to drive UI affordances.
 *
 * RBAC recap for `clients` (lib/rbac/permissions.ts, matches
 * docs/ARCHITECTURE.md matrix): `owner` has CRUD; `planner`/`finance`/
 * `administratie` have plain `read` (full org-wide read); `engineer` has
 * only `read_own` ("Read (assigned)" in the matrix). There is no
 * assignment relationship modeled on `clients` yet (that's a Phase 2
 * concept, once contracts/work_orders exist), so there is currently no data
 * to scope "own" by — `read_own` is treated the same as `read` here for
 * now (i.e. an Engineer sees every client in their org, same as what RLS
 * already allows any member to SELECT). Revisit this the moment a
 * client-assignment concept exists; don't assume this is a deliberate
 * long-term product decision, it's a stopgap forced by the schema.
 */

export interface ClientRecord {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteRecord {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  is_visit_address: boolean;
  is_invoice_address: boolean;
  is_delivery_address: boolean;
  is_primary: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientDependencyCounts {
  sites: number;
  assets: number;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toClientInsertRow(input: ReturnType<typeof clientCreateSchema.parse>, organizationId: string) {
  return {
    organization_id: organizationId,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  };
}

function toClientUpdateRow(input: ReturnType<typeof clientUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.email !== undefined) row.email = input.email ?? null;
  if (input.phone !== undefined) row.phone = input.phone ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

/** Purpose/primary flags are passed in separately (`purpose`) rather than
 * read straight off `input`: `createSite` computes their final values itself
 * (either the caller's submitted values, or the "first site for this
 * client" server-side override — see `createSite`), never trusting
 * `input`'s raw booleans directly for the write. `geocoded` is the result
 * (or `null`) of `geocodeAddress`, written alongside `latitude`/`longitude`. */
function toSiteInsertRow(
  input: SiteCreateInput,
  purpose: { isVisitAddress: boolean; isInvoiceAddress: boolean; isDeliveryAddress: boolean; isPrimary: boolean },
  geocoded: { latitude: number; longitude: number } | null,
) {
  return {
    client_id: input.clientId,
    name: input.name,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2 ?? null,
    postal_code: input.postalCode,
    city: input.city,
    country: input.country,
    notes: input.notes ?? null,
    is_visit_address: purpose.isVisitAddress,
    is_invoice_address: purpose.isInvoiceAddress,
    is_delivery_address: purpose.isDeliveryAddress,
    is_primary: purpose.isPrimary,
    latitude: geocoded?.latitude ?? null,
    longitude: geocoded?.longitude ?? null,
    geocoded_at: geocoded ? new Date().toISOString() : null,
  };
}

/** `geocoded` is only ever a real `{ latitude, longitude }` result here, never
 * `null`/`undefined`: per spec, a geocoding miss (no match/failure) on an
 * update must leave `latitude`/`longitude`/`geocoded_at` **unchanged**
 * (unlike `toSiteInsertRow`, where a miss writes explicit `null`s onto a
 * brand-new row that has no prior value to preserve) — so `updateSite` only
 * calls this with a `geocoded` argument at all when `geocodeAddress`
 * actually returned a match; a miss (or no address field touched) simply
 * omits the argument and the columns are left out of `row` entirely. */
function toSiteUpdateRow(input: SiteUpdateInput, geocoded?: { latitude: number; longitude: number }) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.name !== undefined) row.name = input.name;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1;
  if (input.addressLine2 !== undefined) row.address_line2 = input.addressLine2 ?? null;
  if (input.postalCode !== undefined) row.postal_code = input.postalCode;
  if (input.city !== undefined) row.city = input.city;
  if (input.country !== undefined) row.country = input.country;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  if (input.isVisitAddress !== undefined) row.is_visit_address = input.isVisitAddress;
  if (input.isInvoiceAddress !== undefined) row.is_invoice_address = input.isInvoiceAddress;
  if (input.isDeliveryAddress !== undefined) row.is_delivery_address = input.isDeliveryAddress;
  if (input.isPrimary !== undefined) row.is_primary = input.isPrimary;
  if (geocoded) {
    row.latitude = geocoded.latitude;
    row.longitude = geocoded.longitude;
    row.geocoded_at = new Date().toISOString();
  }
  return row;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface ListClientsOptions {
  limit?: number;
  offset?: number;
}

export async function listClients(
  options: ListClientsOptions = {},
): Promise<ActionResult<{ clients: ClientRecord[]; count: number }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view clients.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  const { data, error, count } = await supabase
    .from("clients")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return fail(mapDbError(error));
  return ok({ clients: (data ?? []) as ClientRecord[], count: count ?? 0 });
}

export async function getClient(
  id: string,
): Promise<ActionResult<{ client: ClientRecord; sites: SiteRecord[] }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view this client.");
  }

  const supabase = await createSupabaseServerClient();
  const [clientResult, sitesResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", idResult.data).maybeSingle(),
    supabase.from("sites").select("*").eq("client_id", idResult.data).order("name", { ascending: true }),
  ]);

  if (clientResult.error) return fail(mapDbError(clientResult.error));
  if (!clientResult.data) return fail("Client not found.");
  if (sitesResult.error) return fail(mapDbError(sitesResult.error));

  return ok({
    client: clientResult.data as ClientRecord,
    sites: (sitesResult.data ?? []) as SiteRecord[],
  });
}

export async function createClient(input: unknown): Promise<ActionResult<{ client: ClientRecord }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can create clients.");
  }

  const parsed = clientCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .insert(toClientInsertRow(parsed.data, ctx.context.organizationId))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ client: data as ClientRecord });
}

export async function updateClient(
  id: string,
  input: unknown,
): Promise<ActionResult<{ client: ClientRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update clients.");
  }

  const parsed = clientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toClientUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to update it.");
  return ok({ client: data as ClientRecord });
}

/**
 * Dependency counts for the delete-confirmation UI. `sites.client_id` and
 * `assets.client_id` both have `on delete cascade` at the DB level (see
 * `supabase/migrations/20260822190000_clients_sites_assets.sql`), so
 * deleting a client silently deletes every one of its sites and assets too
 * — the caller should show this count before letting the user confirm.
 */
export async function getClientDependencyCounts(id: string): Promise<ActionResult<ClientDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view this client.");
  }

  const supabase = await createSupabaseServerClient();
  const [sitesResult, assetsResult] = await Promise.all([
    supabase.from("sites").select("id", { count: "exact", head: true }).eq("client_id", idResult.data),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("client_id", idResult.data),
  ]);

  if (sitesResult.error) return fail(mapDbError(sitesResult.error));
  if (assetsResult.error) return fail(mapDbError(assetsResult.error));

  return ok({ sites: sitesResult.count ?? 0, assets: assetsResult.count ?? 0 });
}

/**
 * Hard delete. Cascades to `sites` and `assets` at the DB level (see
 * `getClientDependencyCounts` above) — call that first and have the UI
 * confirm before calling this.
 */
export async function deleteClient(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "delete")) {
    return fail("Only the organization owner can delete clients.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

// ---------------------------------------------------------------------------
// Sites (a client's physical locations — a client needs at least one for
// assets to attach to). Gated on the `clients` module/RBAC entry, same as
// the client record itself: sites aren't a separate row in the RBAC matrix,
// they're a sub-resource of Clients.
// ---------------------------------------------------------------------------

export async function listSites(clientId: string): Promise<ActionResult<{ sites: SiteRecord[] }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view sites.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("client_id", idResult.data)
    .order("name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ sites: (data ?? []) as SiteRecord[] });
}

type SitePurposeKey = "is_visit_address" | "is_invoice_address" | "is_delivery_address";

const SITE_PURPOSE_KEYS: readonly SitePurposeKey[] = ["is_visit_address", "is_invoice_address", "is_delivery_address"];

const SITE_PURPOSE_LABELS: Record<SitePurposeKey, string> = {
  is_visit_address: "visit address",
  is_invoice_address: "invoice address",
  is_delivery_address: "delivery address",
};

/**
 * Cross-row invariant, deliberately NOT DB-enforced (see migration header of
 * `supabase/migrations/20260825090000_sites_addresses.sql`): across ALL of a
 * client's sites, each of `is_visit_address`/`is_invoice_address`/
 * `is_delivery_address` must be covered by at least one site (one site may
 * cover more than one). Given the purposes a write would drop off one site
 * and every *other* site for that client, returns the subset that would end
 * up covered by nothing (empty = safe to proceed).
 *
 * Deliberately only prevents a write from making things *worse* — some
 * pre-migration clients may already lack full coverage (their sites were
 * backfilled `is_visit_address = true` only), and that's expected; this
 * never retroactively requires full coverage before allowing any edit.
 */
function uncoveredPurposesAfterDrop(
  droppedPurposes: SitePurposeKey[],
  otherSites: Pick<SiteRecord, SitePurposeKey>[],
): SitePurposeKey[] {
  return droppedPurposes.filter((key) => !otherSites.some((site) => site[key] === true));
}

function uncoveredPurposesError(uncovered: SitePurposeKey[]): string {
  const names = uncovered.map((key) => SITE_PURPOSE_LABELS[key]).join(", ");
  const noun = uncovered.length === 1 ? "purpose" : "purposes";
  return `This client would be left with no site covering: ${names}. Assign that ${noun} to another site first.`;
}

export async function createSite(input: unknown): Promise<ActionResult<{ site: SiteRecord }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can create sites.");
  }

  // Parsed against the un-refined base shape, not the refined
  // `siteCreateSchema` (see that schema's comment in `./schema.ts`): the
  // "first site for this client" override below must be able to force the
  // purpose flags to `true` even when the caller submitted none of them, so
  // the "at least one purpose" rule can't be allowed to reject the request
  // before that override gets a chance to run.
  const parsed = siteBaseSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("client_id", parsed.data.clientId);
  if (countError) return fail(mapDbError(countError));

  const isFirstSite = (count ?? 0) === 0;

  let purpose: { isVisitAddress: boolean; isInvoiceAddress: boolean; isDeliveryAddress: boolean; isPrimary: boolean };
  if (isFirstSite) {
    // App-layer invariant (not DB-enforced — see migration header): the
    // first site for a client always covers every purpose and is primary,
    // regardless of what the form submitted.
    purpose = { isVisitAddress: true, isInvoiceAddress: true, isDeliveryAddress: true, isPrimary: true };
  } else {
    purpose = {
      isVisitAddress: parsed.data.isVisitAddress ?? false,
      isInvoiceAddress: parsed.data.isInvoiceAddress ?? false,
      isDeliveryAddress: parsed.data.isDeliveryAddress ?? false,
      isPrimary: parsed.data.isPrimary ?? false,
    };
    if (!purpose.isVisitAddress && !purpose.isInvoiceAddress && !purpose.isDeliveryAddress) {
      return fail("Please fix the highlighted fields.", { isVisitAddress: [SITE_PURPOSE_REQUIRED_MESSAGE] });
    }
  }

  // Story requirement: "Pin op kaart wordt bepaald door adres gegevens, niet
  // latlong" — always geocode on create (there is no prior pin to preserve).
  // Never blocks the save: `geocodeAddress` never throws, and a `null` (no
  // match/failure) just leaves latitude/longitude/geocoded_at null.
  const geocoded = await geocodeAddress({
    addressLine1: parsed.data.addressLine1,
    postalCode: parsed.data.postalCode,
    city: parsed.data.city,
    country: parsed.data.country,
  });

  const { data, error } = await supabase
    .from("sites")
    .insert(toSiteInsertRow(parsed.data, purpose, geocoded))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ site: data as SiteRecord });
}

export async function updateSite(id: string, input: unknown): Promise<ActionResult<{ site: SiteRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid site id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update sites.");
  }

  const parsed = siteUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: existingError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", idResult.data)
    .maybeSingle();
  if (existingError) return fail(mapDbError(existingError));
  if (!existing) return fail("Site not found, or you do not have permission to update it.");
  const existingSite = existing as SiteRecord;

  // "At least one purpose" can't be fully checked by the schema alone on a
  // partial update (it may omit all three flags, meaning "leave as-is") —
  // merge with the existing row's flags first. Mirrors
  // sites_at_least_one_purpose / SITE_PURPOSE_REQUIRED_MESSAGE.
  const mergedPurpose: Record<SitePurposeKey, boolean> = {
    is_visit_address: parsed.data.isVisitAddress ?? existingSite.is_visit_address,
    is_invoice_address: parsed.data.isInvoiceAddress ?? existingSite.is_invoice_address,
    is_delivery_address: parsed.data.isDeliveryAddress ?? existingSite.is_delivery_address,
  };
  if (!mergedPurpose.is_visit_address && !mergedPurpose.is_invoice_address && !mergedPurpose.is_delivery_address) {
    return fail("Please fix the highlighted fields.", { isVisitAddress: [SITE_PURPOSE_REQUIRED_MESSAGE] });
  }

  // Cross-row purpose coverage (app-layer invariant, not DB-enforced — see
  // uncoveredPurposesAfterDrop): if this update would drop a purpose this
  // site currently covers, another site for the same (origin) client must
  // still cover it, or the write is rejected. Re-parenting to a different
  // client (`clientId` changing) counts as dropping every purpose this site
  // currently covers from the origin client, regardless of what the merged
  // flags end up being on the row itself — the row leaves that client
  // entirely, so it can no longer cover anything for it.
  const isReparenting = parsed.data.clientId !== undefined && parsed.data.clientId !== existingSite.client_id;

  // A site leaving its client is no longer that (former) client's designated
  // primary. `enforce_single_primary_site` only fires `... OF is_primary
  // ...`, so a `client_id`-only change wouldn't otherwise touch `is_primary`
  // — and if the destination client already has its own primary site, both
  // rows would end up `is_primary = true` for the new `client_id`, tripping
  // `sites_one_primary_per_client_idx` (a raw, unmapped 23505). Force it off
  // here, regardless of what the update input submitted for `isPrimary` (same
  // "server enforces it regardless of submitted input" style as the
  // first-site-forces-all-flags override in `createSite`). If the caller
  // wants the site primary at its new client, that's a separate, explicit
  // follow-up update.
  if (isReparenting) {
    parsed.data.isPrimary = false;
  }

  const droppedPurposes = SITE_PURPOSE_KEYS.filter((key) => {
    if (existingSite[key] !== true) return false;
    return isReparenting || mergedPurpose[key] === false;
  });
  if (droppedPurposes.length > 0) {
    const { data: otherSites, error: otherSitesError } = await supabase
      .from("sites")
      .select("is_visit_address, is_invoice_address, is_delivery_address")
      .eq("client_id", existingSite.client_id)
      .neq("id", idResult.data);
    if (otherSitesError) return fail(mapDbError(otherSitesError));

    const uncovered = uncoveredPurposesAfterDrop(
      droppedPurposes,
      (otherSites ?? []) as Pick<SiteRecord, SitePurposeKey>[],
    );
    if (uncovered.length > 0) {
      return fail(uncoveredPurposesError(uncovered));
    }
  }

  // Geocode whenever any address field was part of the update input (per
  // spec — regardless of whether the value actually changed), using the
  // full merged address (existing value + this update's overrides), since
  // Nominatim needs a complete address, not just the changed field(s). A
  // miss (no match/failure) leaves latitude/longitude/geocoded_at unchanged
  // — see `toSiteUpdateRow`.
  const addressTouched =
    parsed.data.addressLine1 !== undefined ||
    parsed.data.addressLine2 !== undefined ||
    parsed.data.postalCode !== undefined ||
    parsed.data.city !== undefined ||
    parsed.data.country !== undefined;

  let geocoded: { latitude: number; longitude: number } | undefined;
  if (addressTouched) {
    geocoded =
      (await geocodeAddress({
        addressLine1: parsed.data.addressLine1 ?? existingSite.address_line1 ?? "",
        postalCode: parsed.data.postalCode ?? existingSite.postal_code ?? "",
        city: parsed.data.city ?? existingSite.city ?? "",
        country: parsed.data.country ?? existingSite.country ?? "",
      })) ?? undefined;
  }

  const row = toSiteUpdateRow(parsed.data, geocoded);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const { data, error } = await supabase
    .from("sites")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Site not found, or you do not have permission to update it.");
  return ok({ site: data as SiteRecord });
}

/**
 * Hard delete. `assets.site_id` also has `on delete cascade` — deleting a
 * site deletes its assets too. Unlike `deleteClient`, this repo's task list
 * doesn't call for a dedicated dependency-count helper for sites, but the
 * same cascade risk applies; `frontend-ui-engineer` can call
 * `listAssets({ siteId })` (see `app/(app)/assets/actions.ts`) to get an
 * accurate count/list for a confirmation dialog if a site delete UI needs
 * one — no separate helper needed since assets are already filterable by
 * `siteId`.
 *
 * Also enforces the same cross-row purpose-coverage invariant as
 * `updateSite` (see `uncoveredPurposesAfterDrop`): deleting a site that is
 * the client's only site covering some purpose is rejected.
 *
 * If the deleted site was `is_primary` and other sites remain for its
 * client, auto-promotes one of the remainder to primary (the earliest
 * `created_at`, same deterministic tie-break the migration's own backfill
 * uses — see `sites_addresses.sql`'s "Backfill" block) as a follow-up update
 * after the delete succeeds, rather than silently leaving the client with
 * zero primary sites (mirrors this codebase's existing pattern of primary
 * reassignment being automatic/system-managed, e.g.
 * `enforce_single_primary_site` auto-unsetting a prior primary on
 * insert/update). If the deleted site was the client's only site, there is
 * nothing to promote — a client can have zero sites.
 */
export async function deleteSite(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid site id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "delete")) {
    return fail("Only the organization owner can delete sites.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: existingError } = await supabase
    .from("sites")
    .select("id, client_id, is_primary, is_visit_address, is_invoice_address, is_delivery_address")
    .eq("id", idResult.data)
    .maybeSingle();
  if (existingError) return fail(mapDbError(existingError));
  if (!existing) return fail("Site not found, or you do not have permission to delete it.");

  const droppedPurposes = SITE_PURPOSE_KEYS.filter((key) => existing[key] === true);
  if (droppedPurposes.length > 0) {
    const { data: otherSites, error: otherSitesError } = await supabase
      .from("sites")
      .select("is_visit_address, is_invoice_address, is_delivery_address")
      .eq("client_id", existing.client_id)
      .neq("id", idResult.data);
    if (otherSitesError) return fail(mapDbError(otherSitesError));

    const uncovered = uncoveredPurposesAfterDrop(
      droppedPurposes,
      (otherSites ?? []) as Pick<SiteRecord, SitePurposeKey>[],
    );
    if (uncovered.length > 0) {
      return fail(uncoveredPurposesError(uncovered));
    }
  }

  const { data, error } = await supabase
    .from("sites")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Site not found, or you do not have permission to delete it.");

  if (existing.is_primary) {
    const { data: remaining, error: remainingError } = await supabase
      .from("sites")
      .select("id")
      .eq("client_id", existing.client_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    // Best-effort: the delete itself already succeeded above, so a failure
    // to look up/promote a replacement primary here is not surfaced as a
    // failure of the delete — it would just leave the client without a
    // primary site until the next explicit "set as primary" action.
    if (!remainingError && remaining) {
      await supabase.from("sites").update({ is_primary: true }).eq("id", remaining.id);
    }
  }

  return ok({ deletedId: data.id as string });
}
