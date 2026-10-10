/**
 * Public URL of a user's profile photo — same shape as the web app's own
 * `lib/profile/avatar-url.ts` (the `avatars` bucket is public; `?v=` busts
 * caches after a re-upload to the same fixed path). `null` when no photo
 * has been uploaded.
 */
export function getAvatarUrl(avatarPath: string | null, avatarUpdatedAt: string | null): string | null {
  if (!avatarPath) return null;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  const version = avatarUpdatedAt ? new Date(avatarUpdatedAt).getTime() : 0;
  return `${base}/storage/v1/object/public/avatars/${avatarPath}?v=${version}`;
}
