"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { getClientLogoUrl } from "@/lib/clients/logo-url";

/**
 * Org-level "own Client" setting (issue #120): `organizations.own_client_id`
 * — which of the tenant's own `clients` rows represents the organization
 * itself, for a future Invoicing module's "from" branding (not built here).
 * Directly modeled on `app/(app)/settings/organization-rate-actions.ts` (same
 * shape: a `get...` read action open to any role that can read `"settings"`,
 * plus an owner-only `update...` action) — see that file's header comment for
 * the full reasoning behind the permission split below, reproduced here only
 * where it differs.
 *
 * **Permission.** `organizations` UPDATE RLS (`organizations_update_owner`,
 * baseline migration) is `is_org_owner` ONLY, regardless of what the
 * application layer would otherwise allow for a given role. Gating
 * `updateOrganizationOwnClient` on `can(actor, "settings", "update")`
 * (owner-only per `lib/rbac/permissions.ts`'s `settings` matrix row) keeps
 * the app-layer check and the DB truth in agreement, rather than letting a
 * non-owner attempt (and always fail) a write that would just bounce off
 * RLS — same "does the gap actually exist" reasoning
 * `organization-rate-actions.ts` already applies. Read access
 * (`getOrganizationCompanySettings`, `listClientsForOwnClientSelect`) stays
 * open to any org member that can read `"settings"`/`"clients"` respectively.
 *
 * Feature-gated on `"settings"` (already shipped — see `lib/rbac/features.ts`),
 * same module `organization-rate-actions.ts` uses for tenant-configurable org
 * settings.
 */

export interface OrganizationOwnClientSettings {
  ownClientId: string | null;
  ownClient: {
    id: string;
    name: string;
    kvkNumber: string | null;
    vatNumber: string | null;
    iban: string | null;
    logoUrl: string | null;
  } | null;
}

interface OwnClientRow {
  id: string;
  name: string;
  kvk_number: string | null;
  vat_number: string | null;
  iban: string | null;
  logo_path: string | null;
  logo_updated_at: string | null;
}

/** Any org member (any tenant role has at least `read` on `settings`). */
export async function getOrganizationCompanySettings(): Promise<ActionResult<OrganizationOwnClientSettings>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "read")) {
    return fail("You do not have permission to view organization settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("own_client_id")
    .eq("id", organizationId)
    .maybeSingle<{ own_client_id: string | null }>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Organization not found.");

  if (!data.own_client_id) {
    return ok({ ownClientId: null, ownClient: null });
  }

  // RLS on `clients` already scopes this lookup to the caller's own
  // organization — `own_client_id` is also validated same-org by the DB's
  // own `validate_organization_own_client` trigger, so this is expected to
  // always hit, but a `maybeSingle()` + null-guard is the same defensive
  // style used throughout this file's precedent.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, kvk_number, vat_number, iban, logo_path, logo_updated_at")
    .eq("id", data.own_client_id)
    .maybeSingle<OwnClientRow>();

  if (clientError) return fail(mapDbError(clientError));
  if (!client) {
    return ok({ ownClientId: data.own_client_id, ownClient: null });
  }

  return ok({
    ownClientId: data.own_client_id,
    ownClient: {
      id: client.id,
      name: client.name,
      kvkNumber: client.kvk_number,
      vatNumber: client.vat_number,
      iban: client.iban,
      logoUrl: getClientLogoUrl(client.logo_path, client.logo_updated_at),
    },
  });
}

/**
 * Lightweight, unpaginated projection of every client in the caller's org,
 * for populating the "own Client" `<Select>` — same shape/precedent as
 * `listArticlesForSelect` (`app/(app)/articles/actions.ts`). Gated on
 * `"clients"` (not `"settings"`) since this is a plain client listing, same
 * module boundary `can(actor, "clients", "read")` already governs elsewhere.
 */
export async function listClientsForOwnClientSelect(): Promise<ActionResult<{ clients: { id: string; name: string }[] }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "read")) {
    return fail("You do not have permission to view clients.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("clients").select("id, name").order("name", { ascending: true });

  if (error) return fail(mapDbError(error));

  return ok({ clients: (data ?? []) as { id: string; name: string }[] });
}

const updateOwnClientSchema = z.object({
  ownClientId: z.string().uuid("Invalid client.").nullable().optional(),
});

/** Defense-in-depth existence check, same pattern as
 * `validateOrganizationDefaultRateArticle` (`organization-rate-actions.ts`) /
 * `validateClientRateOverrideArticle` (`app/(app)/clients/actions.ts`): RLS
 * on `clients` (any org member may SELECT) already scopes this lookup to the
 * caller's own organization, so a hit here also proves org membership.
 * Backstopped either way by the DB's own `validate_organization_own_client`
 * trigger, which this maps to a clean field error rather than a raw
 * `23503`/`23514`. */
async function validateOwnClient(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return {
      ok: false,
      error: "Invalid client — it does not exist, or it does not belong to your organization.",
    };
  }
  return { ok: true };
}

/**
 * Owner-only (see the module comment above for why this deviates from a
 * literal role-matrix reading and instead matches `organizations`' own
 * owner-only RLS). Passing `null` explicitly clears the designation.
 */
export async function updateOrganizationOwnClient(
  input: unknown,
): Promise<ActionResult<OrganizationOwnClientSettings>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can update the organization's own client.");
  }

  const parsed = updateOwnClientSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.ownClientId) {
    const check = await validateOwnClient(supabase, parsed.data.ownClientId);
    if (!check.ok) return fail("Please fix the highlighted fields.", { ownClientId: [check.error] });
  }

  const { error } = await supabase
    .from("organizations")
    .update({ own_client_id: parsed.data.ownClientId ?? null })
    .eq("id", organizationId);

  if (error) return fail(mapDbError(error));

  return getOrganizationCompanySettings();
}
