import type { ReactNode } from "react";
import { Logo } from "@yourorg/ui";
import { requireEngineerSession } from "@/lib/auth/session";
import { BottomBar } from "./_nav/bottom-bar";

/**
 * Protected route group for the monteur-app (issue #168). Gates every route
 * under it on `requireEngineerSession()` — signed-out or non-`engineer`
 * roles are redirected to `/login` there.
 *
 * Issue #170 adds the app's only nav chrome: `BottomBar`, mounted once here
 * so both `/today` and `/work-orders/[id]` share the exact same instance
 * (IMPLEMENTATION.md §3 — "don't reinvent the pattern per module"/per page).
 * `.ui-bottom-bar-scroll-spacer` reserves the ~104px the fixed bar occupies
 * (§3) so the last row of any page's content never falls underneath it;
 * `.ui-pwa-page-content` is this app's one shared page-padding class (see
 * styles.css) since there's no sidebar/topbar chrome to already provide
 * side margins.
 *
 * `Logo` (product feedback, 2026-09-12: "Norr logo always top left in the
 * app, with the name") is mounted once here too, same "shared chrome, not
 * per-page" reasoning as `BottomBar` — it already renders the full wordmark
 * WITH the name by default (it only collapses to the bare icon inside the
 * desktop sidebar's `.ui-sidebar-collapsed`, which doesn't exist in this
 * app), so no separate icon-only variant is needed here.
 */
export default async function AppRouteLayout({ children }: { children: ReactNode }) {
  await requireEngineerSession();
  return (
    <>
      <div className="ui-pwa-page-content ui-bottom-bar-scroll-spacer">
        <div className="ui-pwa-logo-row">
          <Logo />
        </div>
        {children}
      </div>
      <BottomBar />
    </>
  );
}
