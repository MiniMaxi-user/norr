import { Heading, Stack, Text } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { ProfilePanelRoute } from "./profile-panel-route";

export const metadata = { title: "Profile" };

/**
 * Real, deep-linkable `/profile` route (issue #49) — opens the exact same
 * `ProfilePanel` the topbar `UserMenu`'s "Profiel" item does, just
 * pre-opened via `ProfilePanelRoute`. Renders inside the normal
 * authenticated app shell (this route lives under `app/(app)`, so
 * `app/(app)/layout.tsx`'s `requireSession()` gate + `AppShell` chrome
 * already apply — no separate auth check needed here beyond resolving the
 * session's own data for the panel's fields).
 *
 * Deliberately NOT gated by `hasFeature()` — same identity-level reasoning
 * as `ProfilePanel`/`app/(app)/profile/actions.ts` — every authenticated
 * user can reach this, regardless of role or org entitlements.
 *
 * The page's own visible content is minimal on purpose: it's almost always
 * fully covered by the slide-over panel the instant it mounts, so there's
 * nothing meaningful to design here beyond a plain, fast fallback for the
 * brief moment before the panel's own entrance animation completes (or for
 * a no-JS/slow-hydration edge case).
 */
export default async function ProfilePage() {
  const session = await requireSession();

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Profile</Heading>
        <Text tone="muted">Your personal settings.</Text>
      </Stack>

      <ProfilePanelRoute
        email={session.email}
        fullName={session.fullName}
        avatarUrl={session.avatarUrl}
        locale={session.locale}
      />
    </Stack>
  );
}
