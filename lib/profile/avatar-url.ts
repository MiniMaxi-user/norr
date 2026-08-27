/**
 * Derives the public URL for a user's profile photo (issue #49) from
 * `users.avatar_path`/`avatar_updated_at`. Deliberately NOT `server-only` —
 * it's pure string logic (no secrets, `NEXT_PUBLIC_SUPABASE_URL` is already
 * a public env var), reused server-side by `lib/auth/session.ts` and safe to
 * import from a client component too if a future call site needs it.
 *
 * `avatar_path` is a Storage OBJECT PATH (e.g. "{user_id}/avatar.webp"), not
 * a URL — see the migration
 * (`supabase/migrations/20260826140000_user_profile_avatar_locale.sql`) for
 * why: the "avatars" Storage bucket is public, so the public object URL is
 * always derivable from the path alone, no signed URL needed.
 *
 * The `?v=` query param cache-busts on photo change (re-upload reuses the
 * same fixed path, so without this the browser/CDN would keep serving the
 * old image) — built from `avatar_updated_at`, which a DB trigger stamps
 * only when `avatar_path` itself changes, not on unrelated profile edits.
 */
export function getAvatarUrl(avatarPath: string | null, avatarUpdatedAt: string | null): string | null {
  if (!avatarPath) return null;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  const version = avatarUpdatedAt ? new Date(avatarUpdatedAt).getTime() : 0;
  return `${base}/storage/v1/object/public/avatars/${avatarPath}?v=${version}`;
}
