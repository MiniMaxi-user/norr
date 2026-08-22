import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MainSkeleton } from "@/components/shell/main-skeleton";
import { preferencesStore } from "@/lib/preferences/cookie-store";

// This route group is the authenticated app shell: everything rendered
// through here gets the sidebar/topbar chrome. Marketing/auth pages
// (login, signup, invite-accept) belong in a sibling route group — e.g.
// `app/(auth)/*` — that does NOT import AppShell, so they render without
// this chrome.
//
// TODO(auth-rbac-engineer, issues #3/#4): this is the seam for real auth.
// Resolve the session here (see lib/supabase/server.ts) and:
//   - redirect to /login when there's no session
//   - pass the user/organization down to `AppShell` (account switcher,
//     `preferencesStore` lookups keyed by user id instead of `null`)
// Nothing below should be read as "this route is protected" yet — it isn't.
export default async function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const defaultSidebarCollapsed = await preferencesStore.getSidebarCollapsed(null);

  return (
    <AppShell defaultSidebarCollapsed={defaultSidebarCollapsed}>
      <Suspense fallback={<MainSkeleton />}>{children}</Suspense>
    </AppShell>
  );
}
