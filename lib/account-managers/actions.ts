"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { accountManagerCreateSchema, accountManagerUpdateSchema } from "./schema";

/**
 * Server Actions for `public.account_managers` (issue #58 — the Account
 * Manager picker for the Clients kanban board). Same four-step preamble as
 * every other module's actions (module context -> `can()` -> Zod validation
 * -> query under the caller's own session) — see `lib/asset-models/actions.ts`,
 * this file's direct template.
 *
 * A much simpler table than `asset_models` (two required text fields, no
 * cross-FK validation), so this module is deliberately shorter — no
 * reference-item lookups, no dependent-list cross-checks.
 *
 * RBAC: reuses the existing `"settings"` module (owner: CRUD, every other
 * tenant role: `read`) — same boundary `asset_models` actions use, and
 * matches this table's RLS exactly (select: any member; insert/update/
 * delete: owner only), so there is no "allowed by `can()`, silently rejected
 * by RLS" gap to document here either.
 */

export interface AccountManagerRecord {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

/** Any org member can call this (populates the Account Manager manager table
 * in Settings, and the Account Manager picker on a Client). */
export async function listAccountManagers(): Promise<ActionResult<{ accountManagers: AccountManagerRecord[] }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view account managers.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_managers")
    .select("*")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ accountManagers: (data ?? []) as AccountManagerRecord[] });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function createAccountManager(
  input: unknown,
): Promise<ActionResult<{ accountManager: AccountManagerRecord }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can add account managers.");
  }

  const parsed = accountManagerCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_managers")
    .insert({
      organization_id: ctx.context.organizationId,
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
    })
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ accountManager: data as AccountManagerRecord });
}

/** Owner only. Partial update — see `lib/account-managers/schema.ts`'s doc
 * comment for why `accountManagerUpdateSchema` is a plain `.partial()`. */
export async function updateAccountManager(
  id: string,
  input: unknown,
): Promise<ActionResult<{ accountManager: AccountManagerRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid account manager id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can edit account managers.");
  }

  const parsed = accountManagerUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.firstName !== undefined) row.first_name = parsed.data.firstName;
  if (parsed.data.lastName !== undefined) row.last_name = parsed.data.lastName;
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_managers")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Account manager not found, or you do not have permission to edit it.");
  return ok({ accountManager: data as AccountManagerRecord });
}

/**
 * Owner only. Hard delete. `clients.account_manager_id` references this
 * table `on delete set null` (see migration
 * `20260827100000_clients_kanban_status.sql`), so deleting an Account
 * Manager currently assigned to clients is NOT blocked — any client
 * pointing at it simply falls back to no Account Manager. No dependency-
 * count check needed (unlike `deleteClient`'s cascade-delete warning, which
 * exists because THAT delete destroys dependent rows outright).
 */
export async function deleteAccountManager(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid account manager id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete account managers.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_managers")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Account manager not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
