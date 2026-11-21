import type { ReactNode } from "react";
import { requireEngineerSession } from "@/lib/auth/session";
import { BottomBar } from "./_nav/bottom-bar";
import { Topbar } from "./_nav/topbar";
import { FeaturesProvider } from "@/lib/features/use-features";

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
 * `.pwa-shell` (bug report, 2026-09-13) is a whole-viewport flex column —
 * `Topbar` (the 56px app bar) and `BottomBar` each claim their own row, top
 * and bottom, `.pwa-scroll` gets everything in between and scrolls within
 * that bound, so a page's content always stays between the two bars instead
 * of running behind either one. Each screen renders its own navy page header
 * + `PwaBody` inside `.pwa-scroll` (DS 08 "Opbouw van elk scherm").
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
    <FeaturesProvider currentUserId={session.userId}>
    <div className="pwa-shell">
      <Topbar
        fullName={session.fullName}
        email={session.email}
        avatarUrl={session.avatarUrl}
        currentUserId={session.userId}
      />
      <div className="pwa-scroll">{children}</div>
      <BottomBar />
    </div>
    </FeaturesProvider>
  );
}
