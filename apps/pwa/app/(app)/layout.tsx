import type { ReactNode } from "react";
import { requireEngineerSession } from "@/lib/auth/session";
import { BottomBar } from "./_nav/bottom-bar";
import { Topbar } from "./_nav/topbar";

/**
 * Protected route group for the monteur-app (issue #168). Gates every route
 * under it on `requireEngineerSession()` — signed-out or non-`engineer`
 * roles are redirected to `/login` there.
 *
 * Issue #170 adds the app's nav chrome: `BottomBar`, plus `Topbar` (product
 * feedback, 2026-09-13 — logo + profile avatar must be visible on every
 * screen, not just Today, where the avatar used to live). Both mounted once
 * here so every route under this layout shares the exact same instances
 * (IMPLEMENTATION.md §3 — "don't reinvent the pattern per module"/per page).
 * `.ui-pwa-shell` (bug report, 2026-09-13) is a whole-viewport flex column —
 * `Topbar` and `BottomBar` each claim their own row, top and bottom,
 * `.ui-pwa-page-content` gets everything in between and scrolls within that
 * bound, so a page's content always stays between the two bars instead of
 * running behind either one. `.ui-pwa-page-content` is also this app's one
 * shared page-padding class (see styles.css) since there's no sidebar
 * chrome to already provide side margins.
 *
 * `requireEngineerSession()`'s return value (previously discarded) now
 * feeds `Topbar`'s avatar/profile-sheet — the same `fullName`/`email`/
 * `userId` shape `today/page.tsx` and `work-orders/[id]/page.tsx` already
 * re-read via the `cache()`-wrapped `getCurrentEngineerSession()` for their
 * own screens, so this is a free reuse, not a second round-trip.
 */
export default async function AppRouteLayout({ children }: { children: ReactNode }) {
  const session = await requireEngineerSession();
  return (
    <div className="ui-pwa-shell">
      <Topbar fullName={session.fullName} email={session.email} currentUserId={session.userId} />
      <div className="ui-pwa-page-content">{children}</div>
      <BottomBar />
    </div>
  );
}
