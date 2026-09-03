/**
 * Derives the public URL for a client's logo (issue #120) from
 * `clients.logo_path`/`logo_updated_at` — directly modeled on
 * `lib/profile/avatar-url.ts`'s `getAvatarUrl`, same reasoning applies here
 * verbatim, just against the "client-logos" bucket instead of "avatars".
 * Deliberately NOT `server-only` — pure string logic (no secrets,
 * `NEXT_PUBLIC_SUPABASE_URL` is already a public env var), safe to import
 * from a client component too if a future call site needs it.
 *
 * `logo_path` is a Storage OBJECT PATH (e.g.
 * "{organization_id}/{client_id}/logo.webp"), not a URL — see the migration
 * (`supabase/migrations/20260903090000_clients_logo_and_organization_own_client.sql`)
 * for why: the "client-logos" Storage bucket is public, so the public object
 * URL is always derivable from the path alone, no signed URL needed.
 *
 * The `?v=` query param cache-busts on logo change (re-upload reuses the
 * same fixed path, so without this the browser/CDN would keep serving the
 * old image) — built from `logo_updated_at`, which a DB trigger stamps only
 * when `logo_path` itself changes, not on unrelated client edits.
 */
export function getClientLogoUrl(logoPath: string | null, logoUpdatedAt: string | null): string | null {
  if (!logoPath) return null;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  const version = logoUpdatedAt ? new Date(logoUpdatedAt).getTime() : 0;
  return `${base}/storage/v1/object/public/client-logos/${logoPath}?v=${version}`;
}
