"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/auth/session";
import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { mapModuleError, mapModuleRows, moduleChangesSchema, type ModuleChanges, type ModuleRow } from "@/lib/modules/module-rows";

/**
 * Server Actions for the platform-wide default module bundle (#246) - the
 * modules a NEW tenant starts with. Platform admin only (same gate as the
 * `/platform-settings` page: `session.isPlatformAdmin`, not a tenant role).
 * Existing tenants are never touched by these.
 */

async function requirePlatformAdmin(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.isPlatformAdmin ? null : "Only a platform admin can change the default modules.";
}

export async function listDefaultModules(): Promise<ActionResult<{ rows: ModuleRow[] }>> {
  const denied = await requirePlatformAdmin();
  if (denied) return fail(denied);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_platform_default_features");
  if (error) return fail(mapModuleError(error));
  return ok({ rows: mapModuleRows(data) });
}

export async function setDefaultModules(changes: ModuleChanges): Promise<ActionResult<{ rows: ModuleRow[] }>> {
  const parsed = moduleChangesSchema.safeParse(changes);
  if (!parsed.success) return fail("Invalid module change.");
  const denied = await requirePlatformAdmin();
  if (denied) return fail(denied);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_platform_default_features", { p_changes: parsed.data });
  if (error) return fail(mapModuleError(error));

  const { data, error: listError } = await supabase.rpc("list_platform_default_features");
  if (listError) return fail(mapModuleError(listError));

  revalidatePath("/platform-settings");
  return ok({ rows: mapModuleRows(data) });
}
