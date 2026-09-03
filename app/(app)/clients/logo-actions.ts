"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { getClientLogoUrl } from "@/lib/clients/logo-url";

/**
 * Server Actions for per-client logo upload/removal (issue #120,
 * `clients.logo_path`/`logo_updated_at`, migration
 * `20260903090000_clients_logo_and_organization_own_client.sql`). Kept out of
 * the already-large `app/(app)/clients/actions.ts` per that module's own
 * file-splitting precedent (see e.g. `platform-access-actions.ts` in this
 * same directory).
 *
 * Directly modeled on `app/(app)/profile/actions.ts`'s `uploadAvatar`/
 * `removeAvatar` (same fixed-filename-per-entity, `upsert: true`, re-read-
 * the-trigger-stamped-timestamp-before-returning shape), adapted for a
 * TENANT resource instead of an identity one:
 *   - Every action goes through `requireModuleContext("clients")` first
 *     (CLAUDE.md rules 2 & 3), then gates on `can(actor, "clients",
 *     "update")` — owner-only, same message style as `updateClient`'s "Only
 *     the organization owner can update clients." in `actions.ts`. This
 *     matches the migration's own `client_logos_*_org_owner` Storage
 *     policies (`is_org_owner` on the path's organization_id segment), so
 *     the app-layer gate and the DB/Storage truth agree.
 *   - The target client id is independently verified to belong to the
 *     caller's org (`.from("clients").select("id").eq("id", clientId)
 *     .maybeSingle()`, RLS-scoped) before any Storage call — same defensive-
 *     check style as `validateClientRateOverrideArticle` in `actions.ts`.
 *     Storage itself doesn't know about `clients` rows, only the path's
 *     `{organization_id}` segment, so this is the only thing standing
 *     between "org owner" and "org owner uploading to an unrelated/
 *     nonexistent client id".
 *   - This action does NOT resize/compress the image — the frontend already
 *     does that client-side before calling in, exactly the division of
 *     responsibility `uploadAvatar`'s own comment describes. Validation here
 *     is sanity insurance, not the real size/format enforcement.
 */

const uuidSchema = z.string().uuid("Invalid client id.");

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Confirms `clientId` belongs to the caller's org before touching Storage —
 * RLS on `clients` already scopes the SELECT, so a hit here also proves org
 * membership. Same pattern as `validateClientRateOverrideArticle`
 * (`app/(app)/clients/actions.ts`). */
async function validateClientBelongsToOrg(
  supabase: SupabaseServerClient,
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return { ok: false, error: "Client not found, or you do not have permission to update it." };
  }
  return { ok: true };
}

/**
 * Uploads a (already client-side compressed/resized) logo image and points
 * `clients.logo_path` at it. Fixed per-client filename
 * (`{organization_id}/{client_id}/logo.png`, `upsert: true`) so a re-upload
 * overwrites the same Storage object in place rather than accumulating
 * orphans — see the migration's design note. Expects a single `file` entry
 * in `formData`.
 *
 * PNG, not webp (issue #119 fix): the invoice PDF embeds this logo via
 * `@react-pdf/renderer`, whose image resolver only supports jpg/jpeg/png/svg
 * — a webp upload silently failed to render there. See `compress-logo.ts`'s
 * doc comment for the full explanation; this action just mirrors that
 * format choice in the Storage path/content-type.
 */
export async function uploadClientLogo(
  clientId: string,
  formData: FormData,
): Promise<ActionResult<{ logoUrl: string | null }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "clients", "update")) {
    return fail("Only the organization owner can update clients.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("No logo was provided.");
  }
  if (!file.type.startsWith("image/")) {
    return fail("The file must be an image.");
  }
  // The client-side compression always exports a small resized PNG — this
  // cap is just sanity insurance against something unexpected reaching the
  // action directly, not a real "large logo" limit.
  if (file.size > MAX_LOGO_BYTES) {
    return fail("The logo is too large.");
  }

  const supabase = await createSupabaseServerClient();

  const clientCheck = await validateClientBelongsToOrg(supabase, idResult.data);
  if (!clientCheck.ok) return fail(clientCheck.error);

  const path = `${organizationId}/${idResult.data}/logo.png`;
  const { error: uploadError } = await supabase.storage.from("client-logos").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (uploadError) return fail(uploadError.message);

  const { error: updateError } = await supabase
    .from("clients")
    .update({ logo_path: path })
    .eq("id", idResult.data);
  if (updateError) return fail(mapDbError(updateError));

  // Re-read logo_updated_at (server/trigger-stamped, not client-supplied) so
  // the URL returned to the caller is correctly cache-busted immediately,
  // without a full router.refresh() round trip just to see the just-
  // uploaded logo — same reasoning uploadAvatar gives for its own re-read.
  const { data: refreshed } = await supabase
    .from("clients")
    .select("logo_path, logo_updated_at")
    .eq("id", idResult.data)
    .maybeSingle();

  return ok({ logoUrl: getClientLogoUrl(refreshed?.logo_path ?? path, refreshed?.logo_updated_at ?? null) });
}

/** Removes a client's logo: nulls `logo_path` (trigger stamps
 * `logo_updated_at`), then removes the now-orphaned Storage object — a
 * separate call, not a delete-then-null dance, since a fixed filename means
 * there's at most one object to clean up. Mirrors `removeAvatar` exactly. */
export async function removeClientLogo(clientId: string): Promise<ActionResult<{ logoUrl: null }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;

  if (!can(actor, "clients", "update")) {
    return fail("Only the organization owner can update clients.");
  }

  const supabase = await createSupabaseServerClient();

  const clientCheck = await validateClientBelongsToOrg(supabase, idResult.data);
  if (!clientCheck.ok) return fail(clientCheck.error);

  const { data: existing } = await supabase
    .from("clients")
    .select("logo_path")
    .eq("id", idResult.data)
    .maybeSingle();
  const path = existing?.logo_path ?? null;

  const { error: updateError } = await supabase
    .from("clients")
    .update({ logo_path: null })
    .eq("id", idResult.data);
  if (updateError) return fail(mapDbError(updateError));

  if (path) {
    await supabase.storage.from("client-logos").remove([path]);
  }

  return ok({ logoUrl: null });
}
