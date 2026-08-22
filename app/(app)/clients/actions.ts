"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import {
  clientCreateSchema,
  clientUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
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
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
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
    address_line1: input.addressLine1 ?? null,
    address_line2: input.addressLine2 ?? null,
    postal_code: input.postalCode ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    notes: input.notes ?? null,
  };
}

function toClientUpdateRow(input: ReturnType<typeof clientUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.email !== undefined) row.email = input.email ?? null;
  if (input.phone !== undefined) row.phone = input.phone ?? null;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1 ?? null;
  if (input.addressLine2 !== undefined) row.address_line2 = input.addressLine2 ?? null;
  if (input.postalCode !== undefined) row.postal_code = input.postalCode ?? null;
  if (input.city !== undefined) row.city = input.city ?? null;
  if (input.country !== undefined) row.country = input.country ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

function toSiteInsertRow(input: ReturnType<typeof siteCreateSchema.parse>) {
  return {
    client_id: input.clientId,
    name: input.name,
    address_line1: input.addressLine1 ?? null,
    address_line2: input.addressLine2 ?? null,
    postal_code: input.postalCode ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    notes: input.notes ?? null,
  };
}

function toSiteUpdateRow(input: ReturnType<typeof siteUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.name !== undefined) row.name = input.name;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1 ?? null;
  if (input.addressLine2 !== undefined) row.address_line2 = input.addressLine2 ?? null;
  if (input.postalCode !== undefined) row.postal_code = input.postalCode ?? null;
  if (input.city !== undefined) row.city = input.city ?? null;
  if (input.country !== undefined) row.country = input.country ?? null;
  if (input.latitude !== undefined) row.latitude = input.latitude ?? null;
  if (input.longitude !== undefined) row.longitude = input.longitude ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
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

export async function createSite(input: unknown): Promise<ActionResult<{ site: SiteRecord }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can create sites.");
  }

  const parsed = siteCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sites")
    .insert(toSiteInsertRow(parsed.data))
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

  const row = toSiteUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
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
  const { data, error } = await supabase
    .from("sites")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Site not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
