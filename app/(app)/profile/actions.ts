"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { getAvatarUrl } from "@/lib/profile/avatar-url";
import { LOCALES, type Locale } from "@/lib/profile/locale";

/**
 * Server Actions for personal profile management (issue #49) — name,
 * password, profile photo, language preference. Deliberately NOT gated by
 * `hasFeature()`/`requireModuleContext` (unlike every module action in
 * `app/(app)/clients/actions.ts` etc.): this is identity-level, available to
 * every authenticated user regardless of role or org entitlements, not a
 * tenant module. Every action here runs under the CALLER'S OWN session via
 * `lib/supabase/server.ts` (never the service-role client) — a user acting
 * on their own `users` row, already fully covered by the `users_update_self`
 * RLS policy + the column-level GRANTs added in
 * `supabase/migrations/20260826140000_user_profile_avatar_locale.sql`, so no
 * service-role bypass is needed or appropriate (contrast with
 * `app/(app)/clients/platform-access-actions.ts`, which is a platform admin
 * acting on someone else's org and genuinely needs the admin client).
 */

const PASSWORD_MIN_LENGTH = 8; // Same rule signUpAction uses in lib/auth/actions.ts.

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  locale: z.enum(LOCALES, { errorMap: () => ({ message: "Invalid language." }) }),
});

/** Updates the caller's own display name + language preference. */
export async function updateProfile(input: unknown): Promise<ActionResult<{ fullName: string; locale: Locale }>> {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");

  const { error } = await supabase
    .from("users")
    .update({ full_name: parsed.data.fullName, locale: parsed.data.locale })
    .eq("id", user.id);

  if (error) return fail(mapDbError(error));
  return ok({ fullName: parsed.data.fullName, locale: parsed.data.locale });
}

const passwordUpdateSchema = z.object({
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`),
});

/** Changes the caller's own password. No schema/table involved — Supabase
 * Auth owns credentials entirely; this just calls `updateUser` under the
 * caller's own already-established session. */
export async function updatePassword(input: unknown): Promise<ActionResult<{ success: true }>> {
  const parsed = passwordUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) return fail(error.message);

  return ok({ success: true as const });
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Uploads a (already client-side cropped/resized) avatar image and points
 * `users.avatar_path` at it. Fixed per-user filename
 * (`{user_id}/avatar.webp`, `upsert: true`) so a re-upload overwrites the
 * same Storage object in place rather than accumulating orphans — see the
 * migration's design note. Expects a single `file` entry in `formData`
 * (built client-side from the crop tool's exported blob).
 */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ avatarUrl: string | null }>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("No photo was provided.");
  }
  if (!file.type.startsWith("image/")) {
    return fail("The file must be an image.");
  }
  // The client-side cropper always exports a small (256–512px) webp/jpeg —
  // this cap is just sanity insurance against something unexpected reaching
  // the action directly, not a real "large photo" limit.
  if (file.size > MAX_AVATAR_BYTES) {
    return fail("The photo is too large.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");

  const path = `${user.id}/avatar.webp`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/webp",
  });
  if (uploadError) return fail(uploadError.message);

  const { error: updateError } = await supabase.from("users").update({ avatar_path: path }).eq("id", user.id);
  if (updateError) return fail(mapDbError(updateError));

  // Re-read avatar_updated_at (server/trigger-stamped, not client-writable)
  // so the URL returned to the caller is correctly cache-busted immediately,
  // without the caller needing a full `router.refresh()` round trip just to
  // see its own just-uploaded photo.
  const { data: refreshed } = await supabase
    .from("users")
    .select("avatar_path, avatar_updated_at")
    .eq("id", user.id)
    .maybeSingle();

  return ok({ avatarUrl: getAvatarUrl(refreshed?.avatar_path ?? path, refreshed?.avatar_updated_at ?? null) });
}

/** Removes the caller's own profile photo: nulls `avatar_path` (trigger
 * stamps `avatar_updated_at`), then removes the now-orphaned Storage object
 * — a separate call, not a delete-then-null dance, since a fixed filename
 * means there's at most one object to clean up. */
export async function removeAvatar(): Promise<ActionResult<{ avatarUrl: null }>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");

  const { data: existing } = await supabase.from("users").select("avatar_path").eq("id", user.id).maybeSingle();
  const path = existing?.avatar_path ?? null;

  const { error: updateError } = await supabase.from("users").update({ avatar_path: null }).eq("id", user.id);
  if (updateError) return fail(mapDbError(updateError));

  if (path) {
    await supabase.storage.from("avatars").remove([path]);
  }

  return ok({ avatarUrl: null });
}
