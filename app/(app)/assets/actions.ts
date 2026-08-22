"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { assetCreateSchema, assetUpdateSchema } from "./schema";

/**
 * Server Actions for the Assets module, issue #9 backend half. Same shape
 * and preamble pattern as `app/(app)/clients/actions.ts` — see the block
 * comment at the top of that file for the general rules (module context ->
 * `can()`/`canAny()` -> Zod validation -> query under the caller's own
 * session).
 *
 * RBAC recap for `assets` (lib/rbac/permissions.ts): `owner` has CRUD;
 * `planner` has `read` + `update` (no create/delete); `engineer` has only
 * `read_own`/`update_own` ("Read/Update (assigned)" in the matrix — no
 * assignment concept exists on `assets` yet, same caveat as `clients`, see
 * that file's module comment); `finance`/`administratie` have `read` only.
 *
 * *** Known gap: Planner asset UPDATE is allowed by `can()` but silently
 * rejected by RLS today. ***
 * `supabase/migrations/20260822190000_clients_sites_assets.sql` design note
 * 2 documents this: RLS INSERT/UPDATE/DELETE on `assets` is currently
 * `is_org_owner(organization_id)` only, for every action, even though the
 * RBAC matrix grants Planner "Read/Update". Per this feature's task
 * instructions and CLAUDE.md rule 1 ("no service-role shortcuts from client
 * code" / "no exceptions"), `updateAsset` below does NOT work around this
 * with a service-role bypass. Instead:
 *   - `can(actor, "assets", "update")` is checked as-is (this intentionally
 *     returns `true` for a Planner, since the matrix really does grant it —
 *     CLAUDE.md rule 2 forbids special-casing `role === "planner"` here to
 *     preemptively reject it before even asking `can()`).
 *   - The UPDATE is attempted under the caller's own session regardless.
 *   - Live-verified against the linked Supabase project (test users +
 *     direct REST calls, cleaned up after): a Planner's UPDATE on an asset
 *     does NOT raise a `42501` error. Postgres RLS `USING` clause violations
 *     on UPDATE are silently excluded (0 rows affected) rather than erroring
 *     — `42501` is only raised for `WITH CHECK` violations or an outright
 *     missing column-level grant, neither of which applies here (Planner
 *     does have UPDATE-privilege on these columns; it's the `USING
 *     (is_org_owner(organization_id))` row filter that excludes the row).
 *     supabase-js's `.update(...).select("*").maybeSingle()` therefore comes
 *     back as `{ data: null, error: null }` for a Planner's attempt — which
 *     the `if (!data) return fail(...)` check below already handles
 *     correctly, no extra branch needed. (Note: this contradicts the
 *     `throws_ok(..., '42501', ...)` assertion for the equivalent Planner
 *     case in `supabase/tests/database/clients_sites_assets_rls.test.sql` —
 *     that pgTAP test looks stale/incorrect against actual behavior; flagged
 *     here for `db-schema-architect`/`qa-reviewer`, not fixed in this file.)
 *   - Practically: only `owner` sessions can successfully update an asset
 *     today. Planner support is blocked on Phase 2 RLS work (assignment-
 *     based scoping), not on anything in this file.
 */

export interface AssetRecord {
  id: string;
  organization_id: string;
  client_id: string;
  site_id: string;
  name: string;
  type: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  status: "active" | "decommissioned";
  installed_at: string | null;
  warranty_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toAssetInsertRow(input: ReturnType<typeof assetCreateSchema.parse>) {
  return {
    site_id: input.siteId,
    name: input.name,
    type: input.type,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serial_number: input.serialNumber ?? null,
    status: input.status ?? "active",
    installed_at: input.installedAt ?? null,
    warranty_until: input.warrantyUntil ?? null,
    notes: input.notes ?? null,
  };
}

function toAssetUpdateRow(input: ReturnType<typeof assetUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.siteId !== undefined) row.site_id = input.siteId;
  if (input.name !== undefined) row.name = input.name;
  if (input.type !== undefined) row.type = input.type;
  if (input.manufacturer !== undefined) row.manufacturer = input.manufacturer ?? null;
  if (input.model !== undefined) row.model = input.model ?? null;
  if (input.serialNumber !== undefined) row.serial_number = input.serialNumber ?? null;
  if (input.status !== undefined) row.status = input.status;
  if (input.installedAt !== undefined) row.installed_at = input.installedAt ?? null;
  if (input.warrantyUntil !== undefined) row.warranty_until = input.warrantyUntil ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

export interface ListAssetsOptions {
  clientId?: string;
  siteId?: string;
  limit?: number;
  offset?: number;
}

/** List assets, org-scoped via RLS automatically. Supports filtering by
 * `clientId` and/or `siteId` (both optional, combinable) for the map/list
 * views that scope by client — e.g. `listAssets({ clientId })` for "all
 * assets of this client" or `listAssets({ siteId })` for "all assets at
 * this site". */
export async function listAssets(
  options: ListAssetsOptions = {},
): Promise<ActionResult<{ assets: AssetRecord[]; count: number }>> {
  if (options.clientId !== undefined) {
    const clientIdResult = uuidSchema.safeParse(options.clientId);
    if (!clientIdResult.success) return fail("Invalid client id filter.");
  }
  if (options.siteId !== undefined) {
    const siteIdResult = uuidSchema.safeParse(options.siteId);
    if (!siteIdResult.success) return fail("Invalid site id filter.");
  }

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view assets.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("assets").select("*", { count: "exact" });
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.siteId) query = query.eq("site_id", options.siteId);
  query = query.order("name", { ascending: true }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(mapDbError(error));
  return ok({ assets: (data ?? []) as AssetRecord[], count: count ?? 0 });
}

export async function getAsset(id: string): Promise<ActionResult<{ asset: AssetRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "assets", ["read", "read_own"])) {
    return fail("You do not have permission to view this asset.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("assets").select("*").eq("id", idResult.data).maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found.");
  return ok({ asset: data as AssetRecord });
}

/** Owner only (per RBAC matrix + RLS, both agree here — no gap). */
export async function createAsset(input: unknown): Promise<ActionResult<{ asset: AssetRecord }>> {
  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "create")) {
    return fail("Only the organization owner can create assets.");
  }

  const parsed = assetCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assets")
    .insert(toAssetInsertRow(parsed.data))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ asset: data as AssetRecord });
}

/**
 * Owner-only in practice today — see the "Known gap" module comment above.
 * `can()` allows Planner through at the application layer (matrix says
 * Planner has Assets Read/Update); RLS is what actually still blocks a
 * non-owner write in v1 — live-verified as a silent 0-row update (not a
 * `42501`), which surfaces here as the existing "not found, or you do not
 * have permission" message via the `if (!data)` check.
 */
export async function updateAsset(id: string, input: unknown): Promise<ActionResult<{ asset: AssetRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "update")) {
    return fail("You do not have permission to update assets.");
  }

  const parsed = assetUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toAssetUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assets")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found, or you do not have permission to update it.");
  return ok({ asset: data as AssetRecord });
}

/** Owner only (per RBAC matrix + RLS, both agree — Planner has no `delete`
 * action on `assets` at all in the matrix, so there is no gap to document
 * here the way there is for `updateAsset`). */
export async function deleteAsset(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "delete")) {
    return fail("Only the organization owner can delete assets.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assets")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Asset not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
