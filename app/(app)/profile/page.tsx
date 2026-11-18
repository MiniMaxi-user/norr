import { requireSession } from "@/lib/auth/session";
import { ProfileScreen } from "./profile-screen";

export const metadata = { title: "Profile" };

/**
 * `/profile` (issue #49, web design system #222) — the signed-in user's own
 * settings as a real page, reached from the topbar avatar menu's "Profile" item.
 * It renders inside the normal authenticated app shell (`app/(app)/layout.tsx`'s
 * `requireSession()` gate and `AppShell` chrome already apply), so no separate
 * auth check is needed beyond resolving the session's own data.
 *
 * Deliberately NOT gated by `hasFeature()`: identity-level, available to every
 * authenticated user regardless of role or org entitlements (same reasoning as
 * `app/(app)/profile/actions.ts`).
 */
export default async function ProfilePage() {
  const session = await requireSession();

  return (
    <ProfileScreen
      email={session.email}
      fullName={session.fullName}
      avatarUrl={session.avatarUrl}
      locale={session.locale}
    />
  );
}
