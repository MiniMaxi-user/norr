import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listClients } from "../actions";
import { ClientsKanbanView } from "./clients-kanban-view";
import { parseClientsQuery, type ClientsSearchParams } from "./clients-query";
import { ClientsTableCard } from "./clients-table-card";
import { ClientsViewSwitcher, type ClientsView } from "./clients-view-switcher";

/**
 * Async Server Component of `/clients`: fetches, then renders the list-page
 * shell (`WebListPage`) with either the server-driven table or the kanban
 * board. Rendered inside `page.tsx`'s `Suspense` (fallback
 * `WebListSkeleton`), so the header streams in before the data.
 *
 * Table view: `listClients` runs with the filters/sort/page from the URL.
 * Kanban view: the whole pipeline (limit 200), filtered client-side.
 */
export async function ClientsList({
  view,
  params,
  actor,
}: {
  view: ClientsView;
  params: ClientsSearchParams;
  actor: PermissionActor;
}) {
  const canCreate = can(actor, "clients", "create");
  const canDelete = can(actor, "clients", "delete");
  const { page, options } = parseClientsQuery(params);

  const [result, accountManagersResult] = await Promise.all([
    view === "kanban" ? listClients({ limit: 200, includePrimarySite: true }) : listClients(options),
    listAccountManagers(),
  ]);

  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/clients/new">
      New client
    </WebLinkButton>
  ) : undefined;
  const actions = <ClientsViewSwitcher view={view} />;

  if (result.error || !result.data) {
    return (
      <WebListPage module="Clients" title="Clients" actions={actions} primary={primary}>
        <WebCard title="Clients">
          <WebDataTableEmpty>{result.error ?? "Could not load clients."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { clients, count, unfilteredCount, primarySiteByClientId = {} } = result.data;
  const accountManagers = accountManagersResult.data?.accountManagers ?? [];

  return (
    <WebListPage module="Clients" title="Clients" count={unfilteredCount ?? count} actions={actions} primary={primary}>
      {view === "kanban" ? (
        <ClientsKanbanView
          clients={clients}
          canWrite={canCreate}
          primarySiteByClientId={primarySiteByClientId}
          accountManagers={accountManagers}
        />
      ) : (
        <ClientsTableCard
          clients={clients}
          total={count}
          unfilteredTotal={unfilteredCount}
          page={page}
          primarySiteByClientId={primarySiteByClientId}
          accountManagers={accountManagers}
          canCreate={canCreate}
          canDelete={canDelete}
        />
      )}
    </WebListPage>
  );
}
