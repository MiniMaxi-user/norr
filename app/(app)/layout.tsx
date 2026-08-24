import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MainSkeleton } from "@/components/shell/main-skeleton";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { requireSession } from "@/lib/auth/session";

// This route group is the authenticated app shell: everything rendered
// through here gets the sidebar/topbar chrome. Marketing/auth pages
// (login, signup, invite-accept) live in the sibling `app/(auth)/*` route
// group, which does NOT import AppShell, so they render without this
// chrome.
//
// Real auth gate (issue #3/#4): `requireSession()` resolves the session via
// `lib/supabase/server.ts` + the `memberships`/`users` tables and redirects
// to `/login` when there's no session. Every route under `app/(app)` is
// protected as of this layout — nothing below it needs its own auth check
// for "is someone signed in" (a route may still need its own `can()` /
// `hasFeature()` checks for "is this *specific* action/module allowed").
export default async function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const defaultSidebarCollapsed = await preferencesStore.getSidebarCollapsed(session.userId);

  return (
    <AppShell
      defaultSidebarCollapsed={defaultSidebarCollapsed}
      organization={session.organization}
      user={{ email: session.email, fullName: session.fullName, role: session.role }}
    >
      <Suspense fallback={<MainSkeleton />}>{children}</Suspense>
    </AppShell>
  );
}
