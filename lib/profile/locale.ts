/**
 * The app's stored UI-language preference (issue #49) — `public.users.locale`
 * (`supabase/migrations/20260826140000_user_profile_avatar_locale.sql`).
 *
 * IMPORTANT: this is a STORED PREFERENCE ONLY. There is no i18n/translation
 * system anywhere in this app yet — the login/topbar UI is hardcoded Dutch
 * strings, other modules (Clients, Access, ...) are hardcoded English, a
 * pre-existing inconsistency this field does not fix. Changing this value
 * does not currently translate anything; it just remembers the user's
 * choice for whenever real i18n is wired up.
 */
export const LOCALES = ["nl", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
