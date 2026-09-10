import { Suspense } from "react";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { ClientsBoard } from "./components/clients-board";
import { ClientsHeroActions } from "./components/clients-hero-actions";
import { ClientsHeroProvider, type ClientsView } from "./components/clients-hero-context";
import { ClientsHeroStats } from "./components/clients-hero-stats";
import { ClientsSkeleton } from "./components/clients-skeleton";

/**
 * Clients module — list/kanban entry point (issue #8). This module's
 * `enabled` state in the sidebar/command palette already comes from a real
 * `hasFeature()` check (`components/shell/nav-items.ts` ->
 * `resolveNavItems`), and `"clients"` is already in `SHIPPED_FEATURES`
 * (`lib/rbac/features.ts`) — no nav-item flag needed for this to show up.
 *
 * `requireSession()` here (in addition to the one `app/(app)/layout.tsx`
 * already ran) just resolves the actor/user id this page needs; it's cheap
 * and every module page in this codebase does the same (see
 * `lib/actions/module-context.ts`, called again inside `listClients()`).
 *
 * `OverviewHeroBand` renders as a direct sibling BEFORE `<Suspense>` (issue
 * #142 — performance finding on #139) so its `h1` streams to the browser
 * immediately, matching every other module's list page
 * (`app/(app)/articles/page.tsx` etc.) instead of waiting on
 * `listClients`/`listAccountManagers`/`listPrimarySitesForClients` to
 * resolve. Unlike those modules, Clients' band has a stateful `ViewToggle` +
 * "Add client" (`actions`) and a kanban-only stat readout (`stats`) that
 * depend on client data still being fetched inside `Suspense` — both are
 * bridged across the boundary by `ClientsHeroProvider` (see
 * `clients-hero-context.tsx`) rather than living inside `ClientsExplorer` as
 * before.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const session = await requireSession();
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const lastUsedView = await preferencesStore.getLastUsedView(session.userId, "clients");
  const defaultView: ClientsView = lastUsedView === "kanban" ? "kanban" : "list";
  const canWrite = can(actor, "clients", "create");

  return (
    <ClientsHeroProvider defaultView={defaultView}>
      <Stack gap="lg">
        <OverviewHeroBand
          title="Customer overview"
          actions={<ClientsHeroActions canWrite={canWrite} />}
          stats={<ClientsHeroStats />}
        />

        <Suspense key={page} fallback={<ClientsSkeleton />}>
          <ClientsBoard page={page} actor={actor} defaultView={defaultView} />
        </Suspense>
      </Stack>
    </ClientsHeroProvider>
  );
}
