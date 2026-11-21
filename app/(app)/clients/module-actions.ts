"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { mapModuleError, mapModuleRows, moduleChangesSchema, type ModuleChanges, type ModuleRow } from "@/lib/modules/module-rows";

/**
 * Server Actions behind the client detail page's "Modules" tab (#245): a
 * platform admin reads and switches the modules of the tenant organization a
 * client represents. Same gate as the Access tab (`platform-access-actions.ts`):
 * explicit `session.isPlatformAdmin`, and the target org is always derived from
 * `clients.represents_organization_id`, never client-supplied. The RPCs run
 * under the caller's own session (they check `is_platform_admin()` themselves
 * and validate the dependency rules).
 */

const uuidSchema = z.string().uuid("Invalid client id.");

async function resolveTenantOrganization(
  clientId: string,
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  if (!uuidSchema.safeParse(clientId).success) return { ok: false, error: "Invalid client id." };

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!ctx.context.session.isPlatformAdmin) {
    return { ok: false, error: "Only a platform admin can manage a tenant's modules." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("represents_organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!client) return { ok: false, error: "Client not found." };
  if (!client.represents_organization_id) {
    return { ok: false, error: "This client has not been activated as a tenant yet." };
  }
  return { ok: true, organizationId: client.represents_organization_id as string };
}

export async function listTenantModules(clientId: string): Promise<ActionResult<{ rows: ModuleRow[] }>> {
  const target = await resolveTenantOrganization(clientId);
  if (!target.ok) return fail(target.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_organization_features", {
    p_organization_id: target.organizationId,
  });
  if (error) return fail(mapModuleError(error));
  return ok({ rows: mapModuleRows(data) });
}

export async function setTenantModules(
  clientId: string,
  changes: ModuleChanges,
): Promise<ActionResult<{ rows: ModuleRow[] }>> {
  const parsed = moduleChangesSchema.safeParse(changes);
  if (!parsed.success) return fail("Invalid module change.");

  const target = await resolveTenantOrganization(clientId);
  if (!target.ok) return fail(target.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_organization_features", {
    p_organization_id: target.organizationId,
    p_changes: parsed.data,
  });
  if (error) return fail(mapModuleError(error));

  const { data, error: listError } = await supabase.rpc("list_organization_features", {
    p_organization_id: target.organizationId,
  });
  if (listError) return fail(mapModuleError(listError));

  revalidatePath(`/clients/${clientId}`);
  return ok({ rows: mapModuleRows(data) });
}
