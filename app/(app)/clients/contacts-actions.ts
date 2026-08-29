"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { contactCreateSchema, contactUpdateSchema } from "./schema";

/**
 * Server Actions for a client's Contacts (issue #26) — a sub-entity of
 * Clients, per docs/ARCHITECTURE.md's "Relational detail pages"/"Domain
 * completeness" standard, same relationship `sites` has to `clients` (see
 * `app/(app)/clients/actions.ts`). Kept in its own file rather than folded
 * into `actions.ts` since that file's own module comment scopes it to
 * "clients + sites" (issue #8) — same reasoning `asset-form-actions.ts` gives
 * for staying out of `app/(app)/assets/actions.ts`.
 *
 * Same four-step preamble as every other module's actions (module context ->
 * `can()`/`canAny()` -> Zod validation -> query under the caller's own
 * session; RLS is always the real backstop):
 *  - Gated on the `clients` RBAC module/feature, NOT a separate `contacts`
 *    entry — docs/ARCHITECTURE.md's RBAC matrix has no "Contacts" row of its
 *    own, and the migration's RLS boundary on `public.contacts` is the exact
 *    same shape as `sites`/`assets` (select: any org member; write: owner
 *    only), so reusing the `clients` module's `can()` checks keeps the
 *    app-layer and RLS boundaries in agreement (same "no gap to document"
 *    note `app/(app)/clients/actions.ts`'s module comment makes for sites).
 *  - `role_item_id`'s validity (must be a `contact_role` item, same
 *    organization) is enforced by the `validate_contact_role_item` DB
 *    trigger; a bad value already comes back as a clean message via
 *    `mapDbError`'s existing `23514`/`23503` mapping, so there's no extra
 *    app-layer lookup duplicated here the way `assets.subtypeId` needs one
 *    (`contact_role` is a flat, non-dependent list).
 *  - At most one `is_primary = true` per client is enforced by the DB
 *    (`enforce_single_primary_contact` auto-unsets the previous primary in
 *    the same statement, backstopped by the partial unique index
 *    `contacts_one_primary_per_client_idx`). A genuine race between two
 *    concurrent "set as primary" calls for the same client can still surface
 *    as a `23505` (unique_violation) from that index — `mapContactDbError`
 *    below maps that to a clean, retry-suggesting message instead of the
 *    generic fallback `mapDbError` would give it (raw Postgres text), since
 *    `mapDbError` itself has no `23505` case. `sites` has the identical
 *    shape for its own `is_primary` (see `mapSiteDbError` in `./actions.ts`)
 *    — the two are kept as separate module-local mappers, not merged into
 *    `mapDbError` itself, since the user-facing wording differs per entity.
 */

export interface ContactRecord {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  role_item_id: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

/** Maps a DB error from a `contacts` write to a clean, user-safe message.
 * Adds the `23505` (unique_violation) case on top of the shared `mapDbError`
 * — see the module comment above for why this is local to contacts rather
 * than added to `lib/actions/result.ts`'s generic mapping. */
function mapContactDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Another contact was just set as the primary contact for this client. Please try again.";
  }
  return mapDbError(error);
}

function toContactInsertRow(input: ReturnType<typeof contactCreateSchema.parse>, clientId: string) {
  return {
    client_id: clientId,
    name: input.name,
    role_item_id: input.roleItemId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    is_primary: input.isPrimary ?? false,
    notes: input.notes ?? null,
  };
}

function toContactUpdateRow(input: ReturnType<typeof contactUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.roleItemId !== undefined) row.role_item_id = input.roleItemId ?? null;
  if (input.email !== undefined) row.email = input.email ?? null;
  if (input.phone !== undefined) row.phone = input.phone ?? null;
  if (input.isPrimary !== undefined) row.is_primary = input.isPrimary;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

/** Lists a client's contacts, primary contact first. `clientId` is not
 * further ownership-checked beyond being a valid uuid — RLS scopes the
 * result to the caller's own organization regardless of which client's
 * contacts are asked for (same trust boundary `listSites(clientId)` uses). */
export async function listContacts(clientId: string): Promise<ActionResult<{ contacts: ContactRecord[] }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view contacts.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("client_id", idResult.data)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ contacts: (data ?? []) as ContactRecord[] });
}

export async function createContact(
  clientId: string,
  input: unknown,
): Promise<ActionResult<{ contact: ContactRecord }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can add contacts.");
  }

  const parsed = contactCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert(toContactInsertRow(parsed.data, idResult.data))
    .select("*")
    .single();

  if (error) return fail(mapContactDbError(error));
  return ok({ contact: data as ContactRecord });
}

export async function updateContact(
  id: string,
  input: unknown,
): Promise<ActionResult<{ contact: ContactRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid contact id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update contacts.");
  }

  const parsed = contactUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toContactUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapContactDbError(error));
  if (!data) return fail("Contact not found, or you do not have permission to update it.");
  return ok({ contact: data as ContactRecord });
}

/** Hard delete. No cascade concerns (a contact has no children). */
export async function deleteContact(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid contact id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "delete")) {
    return fail("Only the organization owner can delete contacts.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contact not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
