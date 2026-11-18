import { Suspense } from "react";
import { WebListSkeleton } from "@yourorg/ui/web";
import { requireSession } from "@/lib/auth/session";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import type { PermissionActor } from "@/lib/rbac/permissions";
import { ClientsList } from "./components/clients-list";
import type { ClientsSearchParams } from "./components/clients-query";
import type { ClientsView } from "./components/clients-view-switcher";

/**
 * Clients module list page (issue #8, list-page shell of issue #222). The
 * module's `enabled` state in the sidebar/command palette already comes from
 * a real `hasFeature()` check (`components/shell/nav-items.ts`), and
 * `listClients()` re-checks feature + permission server-side.
 *
 * The view (`?view=list|kanban`, default: the user's last-used view) is
 * resolved here; everything data-dependent streams in behind the shaped
 * `WebListSkeleton` (its header paints at once). The `Suspense` is NOT keyed
 * on the filter params on purpose: the table changes the URL in a
 * transition, keeping the old rows on screen (dimmed) and the search box
 * focused while the new page loads.
 */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<ClientsSearchParams> }) {
  const [params, session] = await Promise.all([searchParams, requireSession()]);
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };

  const requested = params.view === "list" || params.view === "kanban" ? params.view : null;
  const view: ClientsView =
    requested ?? ((await preferencesStore.getLastUsedView(session.userId, "clients")) === "kanban" ? "kanban" : "list");

  return (
    <Suspense fallback={<WebListSkeleton module="Clients" title="Clients" columns={7} />}>
      <ClientsList view={view} params={params} actor={actor} />
    </Suspense>
  );
}
