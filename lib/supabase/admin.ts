import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * Per docs/ARCHITECTURE.md: "The service-role key is used only in trusted
 * server-only contexts (billing webhook sync, audited platform-admin
 * cross-tenant reads)." Every call site using this client MUST:
 *   - never run in response to an untrusted client-side query,
 *   - manually enforce/verify tenant scoping in application code, and
 *   - write to `audit_log` when used for platform-admin cross-tenant reads.
 *
 * The `server-only` import guarantees this module errors at build time if
 * ever imported from client-side code.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin client.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
