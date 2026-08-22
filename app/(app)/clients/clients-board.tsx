import { Text } from "@yourorg/ui";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listClients } from "./actions";
import { ClientsExplorer, type ClientsView } from "./clients-explorer";

export const CLIENTS_PAGE_SIZE = 25;

/**
 * Async Server Component doing the actual data fetch — rendered inside a
 * `Suspense` boundary from `page.tsx` so the page shell (heading, "Add
 * client" affordance) streams in immediately while this resolves behind
 * `ClientsSkeleton` (docs/ARCHITECTURE.md: "route-level streaming/Suspense").
 */
export async function ClientsBoard({
  page,
  userId,
  actor,
}: {
  page: number;
  userId: string;
  actor: PermissionActor;
}) {
  const offset = (page - 1) * CLIENTS_PAGE_SIZE;

  const [result, lastUsedView] = await Promise.all([
    listClients({ limit: CLIENTS_PAGE_SIZE, offset }),
    preferencesStore.getLastUsedView(userId, "clients"),
  ]);

  if (result.error || !result.data) {
    return <Text tone="danger">{result.error ?? "Could not load clients."}</Text>;
  }

  const canWrite = can(actor, "clients", "create");
  const defaultView: ClientsView = lastUsedView === "kanban" ? "kanban" : "list";

  return (
    <ClientsExplorer
      clients={result.data.clients}
      count={result.data.count}
      page={page}
      pageSize={CLIENTS_PAGE_SIZE}
      canWrite={canWrite}
      defaultView={defaultView}
    />
  );
}
