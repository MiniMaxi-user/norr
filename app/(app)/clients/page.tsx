import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import type { PermissionActor } from "@/lib/rbac/permissions";
import { ClientsBoard } from "./clients-board";
import { ClientsSkeleton } from "./clients-skeleton";

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

  return (
    <Suspense key={page} fallback={<ClientsSkeleton />}>
      <ClientsBoard page={page} userId={session.userId} actor={actor} />
    </Suspense>
  );
}
